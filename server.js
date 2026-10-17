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

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor parroquial corriendo en el puerto ${PORT}`);
});