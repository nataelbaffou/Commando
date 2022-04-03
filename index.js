const express = require('express');
const fs = require('fs');
const ws = require('ws');

require('dotenv').config();

const app = express();
const getPixels = require('get-pixels');

const multer = require('multer')
const upload = multer({ dest: `${__dirname}/uploads/` });

const VALID_COLORS = ['#BE0039', '#FF4500', '#FFA800', '#FFD635', '#00A368', '#00CC78', '#7EED56', '#00756F', '#009EAA', '#2450A4', '#3690EA', '#51E9F4', '#493AC1', '#6A5CFF', '#811E9F', '#B44AC0', '#FF3881', '#FF99AA', '#6D482F', '#9C6926', '#000000', '#898D90', '#D4D7D9', '#FFFFFF'];

var appData = {
    nbPixelsReplaced: 0,
    currentMap: 'blank.png',
    mapHistory: [
        { file: 'blank.png', reason: 'Feuille blanche', date: 1648890843309 }
    ]
};

if (fs.existsSync(`${__dirname}/data.json`)) {
    appData = require(`${__dirname}/data.json`);
}

setInterval(() => {
    fs.writeFileSync(`${__dirname}/data.json`, JSON.stringify(appData));
    console.log(`Nombres de pixels placés au total: ${appData.nbPixelsReplaced} pixels`);
}, 120000);

const server = app.listen(3987);
const wsServer = new ws.Server({ server: server, path: '/api/ws' });

app.use('/maps', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});
app.use('/maps', express.static(`${__dirname}/maps`));
app.use(express.static(`${__dirname}/static`));

app.get('/api/stats', (req, res) => {
    res.json({
        connectionCount: wsServer.clients.size,
        ...appData,
        date: Date.now()
    });
});

app.post('/updateorders', upload.single('image'), async (req, res) => {
    if (!req.body.reason || !req.body.password || req.body.password != process.env.PASSWORD) {
        res.send('Erreur dans le formulaire !');
        fs.unlinkSync(req.file.path);
        return;
    }

    if (req.file.mimetype !== 'image/png') {
        res.send('L\'image doit être un PNG !');
        fs.unlinkSync(req.file.path);
        return;
    }

    getPixels(req.file.path, 'image/png', function (err, pixels) {
        if (err) {
            res.send('Une erreur est survenue !');
            console.log(err);
            fs.unlinkSync(req.file.path);
            return
        }

        if (pixels.data.length !== 16000000) {
            res.send('L\'image doit etre de 2000x2000 !');
            fs.unlinkSync(req.file.path);
            return;
        }

        for (var i = 0; i < 4000000; i++) {
            const r = pixels.data[i * 4];
            const g = pixels.data[(i * 4) + 1];
            const b = pixels.data[(i * 4) + 2];

            const hex = rgbToHex(r, g, b);
            if (VALID_COLORS.indexOf(hex) === -1) {
                res.send(`Le pixel ${i % 2000}, ${Math.floor(i / 2000)} comporte une couleur invalide.`);
                fs.unlinkSync(req.file.path);
                return;
            }
        }

        const file = `${Date.now()}.png`;
        fs.copyFileSync(req.file.path, `${__dirname}/maps/${file}`);
        fs.unlinkSync(req.file.path);
        appData.currentMap = file;
        appData.mapHistory.push({
            file,
            reason: req.body.reason,
            date: Date.now()
        })
        wsServer.clients.forEach((client) => client.send(JSON.stringify({ type: 'map', data: file, reason: req.body.reason })));
        fs.writeFileSync(`${__dirname}/data.json`, JSON.stringify(appData));
        res.redirect('/');
    });
});

wsServer.on('connection', (socket) => {
    console.log(`[${new Date().toLocaleString()}] [+] Client connecté`);

    socket.on('close', () => {
        console.log(`[${new Date().toLocaleString()}] [-] Client déconnecté`);
    });

    socket.on('message', (message) => {
        var data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            socket.send(JSON.stringify({ type: 'error', data: 'Erreur lors du parsage !' }));
            return;
        }

        if (!data.type) {
            socket.send(JSON.stringify({ type: 'error', data: 'Type de données manquant !' }));
        }

        switch (data.type.toLowerCase()) {
            case 'getmap':
                socket.send(JSON.stringify({ type: 'map', data: appData.currentMap, reason: null }));
                break;
            case 'ping':
                socket.send(JSON.stringify({ type: 'pong' }));
                break;
            case 'placepixel':
                const { x, y, color } = data;
                if (x === undefined || y === undefined || color === undefined && x < 0 || x > 1999 || y < 0 || y > 1999 || color < 0 || color > 32) return;
                appData.nbPixelsReplaced++;
                console.log(`[${new Date().toLocaleString()}] Pixel placé: ${x}, ${y}: ${color}`);
                break;
            default:
                socket.send(JSON.stringify({ type: 'error', data: 'Commande inconnue !' }));
                break;
        }
    });
});

function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}
