// === CONFIGURACIÓN ===
const CLIENT_ID = 'a55b8a1e-58b5-47f0-b954-fbad359103ef';
const REGION = 'sae1.pure.cloud';       
const REDIRECT_URI = window.location.origin + window.location.pathname;

let codeVerifier = localStorage.getItem('code_verifier');

async function login() {
	codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);

	localStorage.setItem('code_verifier', codeVerifier);

	const url = `https://login.${REGION}/oauth/authorize?` +
		`client_id=${CLIENT_ID}` +
		`&response_type=code` +
		`&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
		`&code_challenge=${codeChallenge}` +
		`&code_challenge_method=S256` +
		`&state=xyz`;

	window.location.href = url;
}

async function exchangeCodeForToken(code) {
	const body = new URLSearchParams();
	body.append('grant_type', 'authorization_code');
	body.append('client_id', CLIENT_ID);
	body.append('code', code);
	body.append('redirect_uri', REDIRECT_URI);
	body.append('code_verifier', codeVerifier);

	const response = await fetch(`https://login.${REGION}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body
	});

	const data = await response.json();
	if (data.access_token) {
		localStorage.setItem('access_token', data.access_token);
		return data.access_token;
	} else {
		throw new Error('Error al obtener access token: ' + JSON.stringify(data));
	}
}

async function getCallbacks() {
	const token = localStorage.getItem('access_token');
	if (!token) {
		alert('Debes iniciar sesión primero.');
		return;
	}

	const body = {
		order: 'desc',
		orderBy: 'conversationStart',
		paging: { pageNumber: 1, pageSize: 10 },
		interval: '2025-07-01T03:00:00.000Z/2025-07-31T03:00:00.000Z',
		segmentFilters: [
			{
				type: 'and',
				predicates: [
					{ dimension: 'mediaType', value: 'callback' },
					{ dimension: 'segmentType', value: 'Scheduled' },
					{ dimension: 'segmentEnd', operator: 'notExists' }
				]
			}
		]
	};

	const res = await fetch(`https://api.${REGION}/api/v2/analytics/conversations/details/query`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});

	const data = await res.json();
	buildTable(data.conversations || []);
}


function buildTable(callbacks) {
  const output = document.getElementById('output');
  if (!callbacks.length) {
    output.innerHTML = 'No hay callbacks activos.';
    return;
  }

  let html = `<table cellpadding="10" >
    <thead>
      <tr>
        <th>Nombre</th>
        <th>Teléfono</th>
        <th>Hora de inicio</th>
        <th>Acción</th>
      </tr>
    </thead>
    <tbody>`;

  callbacks.forEach(cb => {
    const contact = cb.participants?.find(p => p.purpose === "customer") || {};
    const nombre = contact.name || "Sin nombre";
    const telefono = contact.address || "N/A";
    const hora = new Date(cb.conversationStart).toLocaleTimeString();

    html += `
      <tr>
        <td>${nombre}</td>
        <td>${telefono}</td>
        <td>${hora}</td>
        <td><button onclick="reprogramar('${cb.conversationId}')">Reprogramar</button></td>
      </tr>`;
  });

  html += `</tbody></table>`;
  output.innerHTML = html;
}

async function reprogramar(conversationId) {
  const token = localStorage.getItem('access_token');
  if (!token) {
    alert('Debes iniciar sesión.');
    return;
  }

  const nuevaFecha = getNewDate();

  const res = await fetch(`https://api.${REGION}/api/v2/conversations/callbacks/${conversationId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
			conversationId:conversationId,
			callbackScheduledTime: nuevaFecha 
		})
  });

  if (res.ok) {
    alert(`Callback reprogramado para ${nuevaFecha}`);
  } else {
    const error = await res.json();
    console.error('Error reprogramando:', error);
    alert('Error reprogramando el callback.');
  }
}

function getNewDate() {
  const ahora = new Date();
  const nueva = new Date(ahora.getTime() + 10000); // 10 segundos después
  return nueva.toISOString();
}



document.getElementById('login').addEventListener('click', login);
document.getElementById('getCallbacks').addEventListener('click', getCallbacks);

// Detectar código de autorización en URL y cambiar por token
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('code')) {
	const code = urlParams.get('code');
	exchangeCodeForToken(code)
		.then(() => {
			history.replaceState(null, '', REDIRECT_URI); // Limpia la URL
			alert('Login exitoso! Ya podés pedir callbacks.');
		})
		.catch(err => alert('Error en login: ' + err.message));
}