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

async function getCallbacks(userId) {
  const token = localStorage.getItem('access_token');
  if (!token) {
    alert('Primero debes iniciar sesión.');
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

  if (userId) {
    body.segmentFilters.push({
      type: 'or',
      predicates: [
        { dimension: 'scoredAgentId', value: userId }
      ]
    });
  }

  const res = await fetch(`https://api.${REGION}/api/v2/analytics/conversations/details/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  await buildTable(data.conversations || []);
}

async function buildTable(callbacks) {
  const token = localStorage.getItem('access_token');
  const output = document.getElementById('output');
  if (!callbacks.length) {
    output.innerHTML = 'No hay callbacks activos.';
    return;
  }

  const rows = await Promise.all(callbacks.map(async cb => {
    const startDate = cb.conversationStart;
    const agents = cb.participants?.filter(p => p.purpose === "agent") || [];
    const contact = agents[agents.length - 1] || {};
    

    const validSessions = contact.sessions
        .filter(s => s.callbackScheduledTime)  // Solo sesiones con callback programado
        .sort((a, b) => new Date(a.callbackScheduledTime) - new Date(b.callbackScheduledTime)); // De más vieja a más nueva

    const phones = validSessions.length > 0 && validSessions[0].callbackNumbers?.[0] 
      ? validSessions[0].callbackNumbers[0] 
      : "N/A";


    const date = validSessions.length > 0 && validSessions[0].callbackScheduledTime
      ? validSessions[0].callbackScheduledTime
      : "N/A";

    const contactName = validSessions.length > 0 && validSessions[0]
    ?  validSessions[0].callbackUserName 
    : "Sin nombre";

    const campaing = await getCampaignName(contact.sessions[0].outboundCampaignId, token) || "Sin nombre";
    const wrapups = obtenerWrapupsDeAgentes(cb.participants)
    console.log(wrapups);
    await resolveWrapupObjects(wrapups, token); // cambia los id por los nombres
    const queue = await getQueueName(contact.sessions[0].segments[0].queueId, token);
    const wrapup_code = wrapups.map(w => w.wrapUpCode ?? "-").join(", ");
    const notes = wrapups.map(w => w.wrapUpNote ?? "-").join(", ");

    return [
      contactName,
      startDate,
      phones,
      date,
      campaing,
      queue,
      wrapup_code,
      notes,
      gridjs.html(`
        <button id="btn-${cb.conversationId}" onclick="reprogramar('${cb.conversationId}')">
          Reprogramar
        </button>
        <span id="timer-${cb.conversationId}" style="margin-left: 10px; font-weight: bold;"></span>
      `)
    ];
  }));

  // Destruir tabla anterior si existe
  if (window.gridInstance) {
    window.gridInstance.destroy();
  }

  // Crear nueva tabla
  window.gridInstance = new gridjs.Grid({
    columns: ["Nombre", "Start Date","Teléfono", "Hora de inicio", "Campaña", "Cola", "Tipificacion", "Notas","Acción"],
    data: rows,
    search: true,
    sort: true,
    resizable : true,
    fixedHeader: true,
    pagination: {
      enabled: true,
      limit: 10
    },
    style: {
      td: { padding: "10px" },
      th: { padding: "10px", backgroundColor: "#f0f0f0" }
    }
  }).render(output);
}

function obtenerWrapupsDeAgentes(participants) {
  const wrapups = [];

  console.log("➡️ Iniciando función obtenerWrapupsDeAgentes");
  if (!participants || !Array.isArray(participants)) {
    console.log("❌ participants no es un array válido:", participants);
    return wrapups;
  }

  participants.forEach((participant, i) => {

    if (participant.purpose === "agent") {
      console.log(`✅ Participant[${i}] es un agent`);

      const sessions = participant.sessions || [];
      console.log(`➡️ Tiene ${sessions.length} sesión(es)`);

      sessions.forEach((session, j) => {
        console.log(`  📞 Session[${j}]`);

        const segments = session.segments || [];
        console.log(`    🔄 Tiene ${segments.length} segmento(s)`);

        segments.forEach((segment, k) => {
        if (segment.segmentType === "wrapup"){
          const code = segment.wrapUpCode || null;
          const note = segment.wrapUpNote || null;

          console.log(`      📍 Segment[${k}]: wrapupCode=${code}, wrapupNotes=${note}`);

          if (code || note) {
            wrapups.push({
              wrapUpCode: code,
              wrapUpNote: note
            });
          }
        }});
      });
    }
  });

  console.log("✅ Finalizado. Wrapups encontrados:", wrapups.length);
  return wrapups;
}

async function reprogramar(conversationId) {
  const token = localStorage.getItem('access_token');
  if (!token) {
    alert('Debes iniciar sesión.');
    return;
  }

  const nuevaFecha = getNewDate();
	const button = document.getElementById(`btn-${conversationId}`);
  const timerSpan = document.getElementById(`timer-${conversationId}`);

  button.disabled = true;
  button.textContent = "Reprogramando...";
  const res = await fetch(`https://api.${REGION}/api/v2/conversations/callbacks/`, {
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
		iniciarTemporizador(timerSpan, button);
  } else {
    const error = await res.json();
    console.error('Error reprogramando:', error);
    alert('Error reprogramando el callback.');
  }
}

function getNewDate() {
  const ahora = new Date();
  // Convertir a equivalente de Montevideo (GMT-3)
  const offsetUruguayEnMs = -3 * 60 * 60 * 1000;
  const horaMontevideo = new Date(ahora.getTime()+offsetUruguayEnMs);
  const nuevaHoraMontevideo = new Date(horaMontevideo.getTime() + 10 * 1000);

  return nuevaHoraMontevideo.toISOString();
}

function iniciarTemporizador(timerElement, button) {
  let segundos = 120;
  timerElement.textContent = `⏳ 120s`;

  const intervalo = setInterval(() => {
    segundos--;
    timerElement.textContent = `⏳ ${segundos}s`;

    if (segundos <= 0) {
      clearInterval(intervalo);
      timerElement.textContent = "";
      button.disabled = false;
      button.textContent = "Reprogramar";
    }
  }, 1000);
}

async function resolveWrapupObjects(wrapupObjects, accessToken) {
  const cache = new Map();
  const isId = (code) => /^[a-zA-Z0-9\-]{8,}$/.test(code);

  const resolved = await Promise.all(
    wrapupObjects.map(async ({ wrapUpCode, wrapUpNote }) => {
      if (!isId(wrapUpCode)) {
        return { wrapUpCode, wrapUpNote };
      }

      if (cache.has(wrapUpCode)) {
        return { wrapUpCode: cache.get(wrapUpCode), wrapUpNote };
      }

      try {
        const response = await fetch(`https://api.${REGION}/api/v2/routing/wrapupcodes/${wrapUpCode}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const name = data.name || wrapUpCode;

        console.log("ACAA:: "+{ wrapUpCode: name, wrapUpNote })
        cache.set(wrapUpCode, name);
        return { wrapUpCode: name, wrapUpNote };
      } catch (error) {
        console.error(`Error fetching wrapUpCode "${wrapUpCode}":`, error.message);
        cache.set(wrapUpCode, wrapUpCode); // fallback
        return { wrapUpCode, wrapUpNote };
      }
    })
  );

  return resolved;
}

async function getQueueName(queueId, accessToken) {
  const url = `https://api.${REGION}/api/v2/routing/queues/${encodeURIComponent(queueId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error al obtener la cola: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.name;
}

async function getCampaignName(campaignId, accessToken) {
  const url = `https://api.${REGION}/api/v2/outbound/campaigns/divisionviews/${encodeURIComponent(campaignId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error al obtener la campaña: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.name;
}


async function obtenerMiPerfil() {
  const token = localStorage.getItem('access_token');
  const response = await fetch(`https://api.${REGION}/api/v2/users/me`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await response.json();
  return data.id; 
}


document.getElementById('login').addEventListener('click', login);
document.getElementById('getCallbacks').addEventListener('click', async () => {
  let userId = urlParams.get('userId'); // primero intenta desde la URL
  if (!userId) {
    userId = await obtenerMiPerfil();   // si no hay, toma el del usuario autenticado
  }
  getCallbacks(userId);
});


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