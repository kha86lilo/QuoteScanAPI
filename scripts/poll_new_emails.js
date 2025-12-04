import http from 'http';

const INTERVAL_MS = 45 * 60 * 1000; // 45 minutes
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PATH = '/api/emails/processnewemails';

function processNewEmails() {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] POST http://${API_HOST}:${API_PORT}${API_PATH}...`);

    const options = {
        hostname: API_HOST,
        port: API_PORT,
        path: API_PATH,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            console.log(`[${timestamp}] Status: ${res.statusCode}`);
            try {
                const json = JSON.parse(data);
                console.log(`[${timestamp}] Response:`, JSON.stringify(json, null, 2));
            } catch {
                console.log(`[${timestamp}] Response: ${data}`);
            }
        });
    }).on('error', (err) => {
        console.error(`[${timestamp}] Error: ${err.message}`);
    });

    req.end();
}

console.log('Starting email polling service...');
console.log(`Will POST to http://${API_HOST}:${API_PORT}${API_PATH} every 5 minutes`);
console.log('Press Ctrl+C to stop\n');

// Run immediately on start
processNewEmails();

// Then run every 5 minutes
setInterval(processNewEmails, INTERVAL_MS);
