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

// Middlewares
app.use(cors());
app.use(express.json());

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
        res.status(500).json({ error: 'Error al obtener intenciones' });
    }
});

// Crear una nueva intención
app.post('/api/intenciones', async (req, res) => {
    try {
        const { nombre, tipo, descripcion, fecha } = req.body;

        const { data, error } = await supabase
            .from('intenciones')
            .insert([{ nombre, tipo, descripcion, fecha }]);

        if (error) throw error;
        res.status(201).json({ mensaje: 'Intención registrada exitosamente', data });
    } catch (err) {
        console.error('Error al guardar intención:', err.message);
        res.status(500).json({ error: 'Error al registrar la intención' });
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
        res.status(500).json({ error: 'Error al eliminar la intención' });
    }
});

// Editar una intención general por ID
app.put('/api/intenciones/:id', async (req, res) => {
    try {
        const { nombre, tipo, descripcion, fecha } = req.body;
        const { data, error } = await supabase
            .from('intenciones')
            .update({ nombre, tipo, descripcion, fecha })
            .eq('id', req.params.id)
            .select();

        if (error) throw error;
        res.status(200).json({ mensaje: 'Intención actualizada exitosamente', data });
    } catch (err) {
        console.error('Error al editar intención:', err.message);
        res.status(500).json({ error: 'Error al editar la intención' });
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
        res.status(500).json({ error: 'Error al obtener la agenda de Misas especiales' });
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

        if (!solicitante || !tipo_misa || !intencion_principal || !fecha_hora) {
            return res.status(400).json({
                error: 'Solicitante, tipo de Misa, intención y fecha son obligatorios'
            });
        }

        const { data, error } = await supabase
            .from('misas')
            .insert([{ solicitante, tipo_misa, intencion_principal, fecha_hora, notas, estado }])
            .select();

        if (error) throw error;
        res.status(201).json({ mensaje: 'Misa especial agendada exitosamente', data });
    } catch (err) {
        console.error('Error al guardar Misa especial:', err.message);
        res.status(500).json({ error: 'Error al agendar la Misa especial' });
    }
});

// Editar una Misa especial por ID
app.put('/api/misas/:id', async (req, res) => {
    try {
        const { solicitante, tipo_misa, intencion_principal, fecha_hora, notas, estado } = req.body;
        const { data, error } = await supabase
            .from('misas')
            .update({ solicitante, tipo_misa, intencion_principal, fecha_hora, notas, estado })
            .eq('id', req.params.id)
            .select();

        if (error) throw error;
        res.status(200).json({ mensaje: 'Misa especial actualizada exitosamente', data });
    } catch (err) {
        console.error('Error al editar Misa especial:', err.message);
        res.status(500).json({ error: 'Error al editar la Misa especial' });
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
        res.status(500).json({ error: 'Error al eliminar la Misa especial' });
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor parroquial corriendo en el puerto ${PORT}`);
});
