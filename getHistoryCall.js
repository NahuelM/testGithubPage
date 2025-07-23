const CLIENT_ID = 'a55b8a1e-58b5-47f0-b954-fbad359103ef';
const REGION = 'sae1.pure.cloud';       
const REDIRECT_URI = window.location.origin + window.location.pathname;

const contactId = 'e9b9652fc0d631a923250621708396fd';

const client = platformClient.ApiClient.instance;

let codeVerifier = localStorage.getItem('code_verifier');
client.setEnvironment(REGION);
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

async function getHistoryCalls(contactId) {
	let access_token = localStorage.getItem('access_token');
	client.setAccessToken(access_token)
  const api = new platformClient.AnalyticsApi();
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(now.getMonth() - 6);
  const interval = `${sixMonthsAgo.toISOString()}/${now.toISOString()}`;

  const query = {
    order: "desc",
    orderBy: "conversationStart",
    paging: { pageSize: 50, pageNumber: 1 },
    interval: "2025-07-01T03:00:00.000Z/2025-08-01T03:00:00.000Z",
    segmentFilters: [
      {
        type: "or",
        predicates: [
          { dimension: "direction", value: "outbound" },
          { dimension: "direction", value: "inbound" }
        ]
      },
      {
        type: "or",
        predicates: [
          { dimension: "outboundContactId", value: contactId }
        ]
      }
    ]
  };

  try {
    const response = await api.postAnalyticsConversationsDetailsQuery(query);
		console.log(response);
    const data = await formatearDatos(response.conversations || []);
    renderTabla(data);
  } catch (err) {
    document.getElementById("tabla").innerText = "Error al buscar llamadas: " + err;
    console.error(err);
  }
}

async function formatearDatos(convs) {
  const usersApi = new platformClient.UsersApi();

  const filas = await Promise.all(convs.map(async conv => {
    const fecha = new Date(new Date(conv.conversationStart).getTime() - 3 * 3600000)
      .toISOString().replace('T', ' ').slice(0, 19);

    const tTalk = sumarTTalkComplete(conv);
    const dnis = obtenerDnis(conv);
    const agentes = await obtenerNombresAgentes(conv, usersApi);
    const wrapups = obtenerWrapups(conv);

    return [
      conv.conversationId,
      fecha,
      tTalk,
      dnis,
      wrapups.codes,
      agentes,
      wrapups.notes
    ];
  }));

  return filas;
}

function renderTabla(data) {
	const contenedor = document.getElementById("tabla");
  contenedor.innerHTML = ""; // ← limpia el contenido anterior
  new gridjs.Grid({
    columns: [
      'Conversation ID',
      'Fecha (GMT-3)',
      'tTalkComplete (s)',
      'DNIS',
      'WrapUp Codes',
      'Agentes',
      'Notas'
    ],
    data: data,
    search: true,
    sort: true,
    pagination: { enabled: true, limit: 10 },
    resizable: true
  }).render(document.getElementById("tabla"));
}

function sumarTTalkComplete(conv) {
  let total = 0;
  for (const p of conv.participants || []) {
    for (const s of p.sessions || []) {
      for (const m of s.metrics || []) {
        if (m.name === "tTalkComplete") total += m.value;
      }
    }
  }
  return (total / 1000).toFixed(1);
}

function obtenerDnis(conv) {
  for (const p of conv.participants || []) {
    for (const s of p.sessions || []) {
      if (s.dnis) return s.dnis.replace("tel:", "").split(";")[0];
    }
  }
  return "-";
}

function obtenerWrapups(conv) {
  const codes = [];
  const notes = [];

  for (const p of conv.participants || []) {
    if (p.purpose === "agent") {
      for (const s of p.sessions || []) {
        for (const seg of s.segments || []) {
          if (seg.segmentType === "wrapup") {
            if (seg.wrapUpCode) codes.push(seg.wrapUpCode);
            if (seg.wrapUpNote) notes.push(seg.wrapUpNote);
          }
        }
      }
    }
  }

  return {
    codes: codes.join(", ") || "-",
    notes: notes.join(", ") || "-"
  };
}

async function obtenerNombresAgentes(conv, usersApi) {
  const ids = new Set();
  for (const p of conv.participants || []) {
    for (const s of p.sessions || []) {
      if (s.selectedAgentId) ids.add(s.selectedAgentId);
    }
  }

  const nombres = await Promise.all([...ids].map(async id => {
    try {
      const user = await usersApi.getUser(id);
      return user.name;
    } catch {
      return `(ID: ${id})`;
    }
  }));

  return nombres.join(", ") || "-";
}

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('code')) {
	const code = urlParams.get('code');
	exchangeCodeForToken(code)
		.then(() => {
			history.replaceState(null, '', REDIRECT_URI); // Limpia la URL
			alert('Login exitoso!');
		})
		.catch(err => alert('Error en login: ' + err.message));
}

if (!window.__alreadyRan) {
	window.__alreadyRan = true;

	(async () => {
		const urlParams = new URLSearchParams(window.location.search);
		const code = urlParams.get('code');

		if (!code) {
			await login(); // hace redirect
		} else {
			await getHistoryCalls(contactId);
		}
	})();
}

