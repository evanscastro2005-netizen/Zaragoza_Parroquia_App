const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Las horas de la parroquia se capturan como hora local de Nicaragua (UTC-6)
// y se almacenan como UTC para que Supabase no las desplace al consultar.
const convertirHoraParroquialAUtc = (valor) => {
    const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(valor);
    if (!partes) return null;
    const [ , anio, mes, dia, hora, minuto ] = partes.map(Number);
    const calendario = new Date(Date.UTC(anio, mes - 1, dia));
    if (calendario.getUTCFullYear() !== anio || calendario.getUTCMonth() !== mes - 1 || calendario.getUTCDate() !== dia || hora > 23 || minuto > 59) return null;
    const fecha = new Date(`${valor}:00-06:00`);
    if (Number.isNaN(fecha.getTime())) return null;
    return fecha;
};

// Sanitización defensiva: se eliminan etiquetas HTML, caracteres angulares y
// caracteres de control antes de procesar cualquier texto recibido.
const sanitizarTexto = (valor) => typeof valor === 'string'
    ? valor.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
    : valor;

const sanitizarEntrada = (valor) => {
    if (Array.isArray(valor)) return valor.map(sanitizarEntrada);
    if (valor && typeof valor === 'object') {
        return Object.fromEntries(Object.entries(valor).map(([clave, contenido]) => [clave, sanitizarEntrada(contenido)]));
    }
    return sanitizarTexto(valor);
};

const campoValido = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const responderError = (res, status, message) => res.status(status).json({ success: false, message, error: message });
const claveDuplicado = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

const existeIntencionDuplicada = async (nombre, tipo, idExcluir = null) => {
    const { data, error } = await supabase.from('intenciones').select('id,nombre,tipo');
    if (error) throw error;
    return data.some(item => item.id !== idExcluir && claveDuplicado(item.nombre) === claveDuplicado(nombre) && claveDuplicado(item.tipo) === claveDuplicado(tipo));
};

const existeMisaDuplicada = async (intencionPrincipal, tipoMisa, idExcluir = null) => {
    const { data, error } = await supabase.from('misas').select('id,intencion_principal,tipo_misa');
    if (error) throw error;
    return data.some(item => item.id !== idExcluir && claveDuplicado(item.intencion_principal) === claveDuplicado(intencionPrincipal) && claveDuplicado(item.tipo_misa) === claveDuplicado(tipoMisa));
};

const existeMisaEnHorario = async (fechaUtc, idExcluir = null) => {
    const siguienteMinuto = new Date(fechaUtc.getTime() + 60 * 1000);
    let consulta = supabase
        .from('misas')
        .select('id')
        .gte('fecha_hora', fechaUtc.toISOString())
        .lt('fecha_hora', siguienteMinuto.toISOString())
        .limit(1);

    if (idExcluir) consulta = consulta.neq('id', idExcluir);
    const { data, error } = await consulta;
    if (error) throw error;
    return data.length > 0;
};

// Middlewares
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && Object.prototype.hasOwnProperty.call(err, 'body')) {
        return responderError(res, 400, 'El cuerpo de la solicitud no contiene un JSON válido');
    }
    next(err);
});
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') req.body = sanitizarEntrada(req.body);
    next();
});

// Servir automáticamente todos los archivos estáticos dentro de "public" (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal -> entrega index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta de administración / sacristía -> entrega admin.html
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// URL corta para pegar directamente en OBS Studio.
app.get('/overlay', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'overlay-intenciones.html'));
});

// Overlay para OBS: devuelve únicamente las intenciones de la fecha local
// de Nicaragua. La fecha puede sobreescribirse con ?fecha=YYYY-MM-DD para
// probar una celebración futura desde OBS.
app.get('/api/overlay/intenciones', async (req, res) => {
    try {
        const fechaNicaragua = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Managua',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '')
            ? req.query.fecha
            : fechaNicaragua;

        const { data, error } = await supabase
            .from('intenciones')
            .select('id,nombre,tipo,descripcion,fecha,created_at')
            .eq('fecha', fecha)
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.set('Cache-Control', 'no-store');
        res.json({ fecha, data });
    } catch (err) {
        console.error('Error al obtener intenciones del overlay:', err.message);
        responderError(res, 500, 'Error al obtener las intenciones del día');
    }
});

// --- API ENDPOINTS (RUTAS CON SUPABASE) ---

// SQL recomendado para crear la tabla en Supabase:
// create table misas (
//   id uuid default gen_random_uuid() primary key,
//   solicitante text,
//   tipo_misa text,
//   intencion_principal text,
//   fecha_hora timestamp,
//   notas text,
//   estado text default 'Programada',
//   created_at timestamp default now()
// );

// Obtener todas las intenciones para el panel
app.get('/api/intenciones', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('intenciones')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error al obtener intenciones:', err.message);
        responderError(res, 500, 'Error al obtener intenciones');
    }
});

// Crear una nueva intención
app.post('/api/intenciones', async (req, res) => {
    try {
        const { nombre, tipo, descripcion, fecha } = req.body;

        if (!campoValido(nombre) || !campoValido(tipo) || !campoValido(fecha)) {
            return responderError(res, 400, 'Nombre, tipo y fecha son obligatorios y no pueden estar vacíos');
        }
        if (await existeIntencionDuplicada(nombre, tipo)) {
            return responderError(res, 409, 'Ya existe una intención con ese nombre y tipo. Puedes registrarla nuevamente si corresponde a otro tipo de intención.');
        }

        const { data, error } = await supabase
            .from('intenciones')
            .insert([{ nombre: nombre.trim(), tipo: tipo.trim(), descripcion: campoValido(descripcion) ? descripcion.trim() : '', fecha: fecha.trim() }]);

        if (error) throw error;
        res.status(201).json({ mensaje: 'Intención registrada exitosamente', data });
    } catch (err) {
        console.error('Error al guardar intención:', err.message);
        responderError(res, 500, 'Error al registrar la intención');
    }
});

// Eliminar una intención general por ID
app.delete('/api/intenciones/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('intenciones')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.status(200).json({ mensaje: 'Intención eliminada exitosamente' });
    } catch (err) {
        console.error('Error al eliminar intención:', err.message);
        responderError(res, 500, 'Error al eliminar la intención');
    }
});

// Editar una intención general por ID
app.put('/api/intenciones/:id', async (req, res) => {
    try {
        const { nombre, tipo, descripcion, fecha } = req.body;
        if (!campoValido(nombre) || !campoValido(tipo) || !campoValido(fecha)) {
            return responderError(res, 400, 'Nombre, tipo y fecha son obligatorios y no pueden estar vacíos');
        }
        if (await existeIntencionDuplicada(nombre, tipo, req.params.id)) {
            return responderError(res, 409, 'Ya existe otra intención con ese nombre y tipo. Puedes usarla si corresponde a otro tipo de intención.');
        }

        const { data, error } = await supabase
            .from('intenciones')
            .update({ nombre: nombre.trim(), tipo: tipo.trim(), descripcion: campoValido(descripcion) ? descripcion.trim() : '', fecha: fecha.trim() })
            .eq('id', req.params.id)
            .select();

        if (error) throw error;
        res.status(200).json({ mensaje: 'Intención actualizada exitosamente', data });
    } catch (err) {
        console.error('Error al editar intención:', err.message);
        responderError(res, 500, 'Error al editar la intención');
    }
});

// Obtener la agenda de Misas especiales ordenada cronológicamente
app.get('/api/misas', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('misas')
            .select('*')
            .order('fecha_hora', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error al obtener Misas especiales:', err.message);
        responderError(res, 500, 'Error al obtener la agenda de Misas especiales');
    }
});

// Registrar una nueva Misa especial
app.post('/api/misas', async (req, res) => {
    try {
        const {
            solicitante,
            tipo_misa,
            intencion_principal,
            fecha_hora,
            notas,
            estado = 'Programada'
        } = req.body;

        if (!campoValido(solicitante) || !campoValido(tipo_misa) || !campoValido(intencion_principal) || !campoValido(fecha_hora)) {
            return responderError(res, 400, 'Solicitante, tipo de Misa, intención y fecha son obligatorios');
        }

        // La fecha/hora recibida representa la hora local de Nicaragua.
        // Se normaliza a UTC antes de consultar y guardar para evitar desfases de 6 horas.
        const fechaUtc = convertirHoraParroquialAUtc(fecha_hora);
        if (!fechaUtc) {
            return responderError(res, 400, 'La fecha y hora de la Misa no son válidas');
        }
        if (await existeMisaDuplicada(intencion_principal, tipo_misa)) {
            return responderError(res, 409, 'Ya existe una Misa privada para ese nombre y tipo de Misa. Puedes registrarla si corresponde a otro tipo de Misa.');
        }

        // Verificar fecha y hora exactas antes de insertar.
        if (await existeMisaEnHorario(fechaUtc)) {
            return responderError(res, 409, 'Ya existe una Misa agendada para este mismo día y hora.');
        }

        const { data, error } = await supabase
            .from('misas')
            .insert([{ solicitante: solicitante.trim(), tipo_misa: tipo_misa.trim(), intencion_principal: intencion_principal.trim(), fecha_hora: fechaUtc.toISOString(), notas: campoValido(notas) ? notas.trim() : '', estado: campoValido(estado) ? estado.trim() : 'Programada' }])
            .select();

        if (error) throw error;
        res.status(201).json({ mensaje: 'Misa especial agendada exitosamente', data });
    } catch (err) {
        console.error('Error al guardar Misa especial:', err.message);
        responderError(res, 500, 'Error al agendar la Misa especial');
    }
});

// Editar una Misa especial por ID
app.put('/api/misas/:id', async (req, res) => {
    try {
        const { solicitante, tipo_misa, intencion_principal, fecha_hora, notas, estado } = req.body;
        if (!campoValido(solicitante) || !campoValido(tipo_misa) || !campoValido(intencion_principal) || !campoValido(fecha_hora)) {
            return responderError(res, 400, 'Solicitante, tipo de Misa, intención y fecha son obligatorios');
        }

        const fechaUtc = convertirHoraParroquialAUtc(fecha_hora);
        if (!fechaUtc) {
            return responderError(res, 400, 'La fecha y hora de la Misa no son válidas');
        }
        if (await existeMisaDuplicada(intencion_principal, tipo_misa, req.params.id)) {
            return responderError(res, 409, 'Ya existe otra Misa privada para ese nombre y tipo de Misa. Puedes usarla si corresponde a otro tipo de Misa.');
        }
        if (await existeMisaEnHorario(fechaUtc, req.params.id)) {
            return responderError(res, 409, 'Ya existe una Misa agendada para este mismo día y hora.');
        }

        const { data, error } = await supabase
            .from('misas')
            .update({ solicitante: solicitante.trim(), tipo_misa: tipo_misa.trim(), intencion_principal: intencion_principal.trim(), fecha_hora: fechaUtc.toISOString(), notas: campoValido(notas) ? notas.trim() : '', estado: campoValido(estado) ? estado.trim() : 'Programada' })
            .eq('id', req.params.id)
            .select();

        if (error) throw error;
        res.status(200).json({ mensaje: 'Misa especial actualizada exitosamente', data });
    } catch (err) {
        console.error('Error al editar Misa especial:', err.message);
        responderError(res, 500, 'Error al editar la Misa especial');
    }
});

// Eliminar una Misa especial por ID
app.delete('/api/misas/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('misas')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.status(200).json({ mensaje: 'Misa especial eliminada exitosamente' });
    } catch (err) {
        console.error('Error al eliminar Misa especial:', err.message);
        responderError(res, 500, 'Error al eliminar la Misa especial');
    }
});

// Última barrera para que una excepción no provoque una respuesta HTML ni detenga el servidor.
app.use('/api', (err, req, res, next) => {
    console.error('Error inesperado en la API:', err);
    if (res.headersSent) return next(err);
    responderError(res, 500, 'Ocurrió un error inesperado. Intenta nuevamente.');
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor parroquial corriendo en el puerto ${PORT}`);
});
