require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 1. Obtener intenciones
app.get('/api/intenciones', async (req, res) => {
    try {
        const { fecha } = req.query;
        let query = supabase.from('intenciones').select('*').order('created_at', { ascending: false });
        
        if (fecha) {
            query = query.eq('fecha_misa', fecha);
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Crear nueva intención
app.post('/api/intenciones', async (req, res) => {
    try {
        const { nombre_solicitante, tipo_intencion, nombre_intencion, fecha_misa, hora_misa } = req.body;
        
        const { data, error } = await supabase
            .from('intenciones')
            .insert([{ 
                nombre_solicitante, 
                tipo_intencion, 
                nombre_intencion, 
                fecha_misa, 
                hora_misa, 
                estado: 'Pendiente'
            }])
            .select();

        if (error) throw error;
        res.status(201).json({ message: 'Intención registrada con éxito', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Actualizar estado
app.patch('/api/intenciones/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;

        const { data, error } = await supabase
            .from('intenciones')
            .update({ estado })
            .eq('id', id)
            .select();

        if (error) throw error;
        res.json({ message: 'Estado actualizado con éxito', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor parroquial corriendo en http://localhost:${PORT}`);
});