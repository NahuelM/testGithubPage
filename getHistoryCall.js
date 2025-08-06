const CLIENT_ID = 'a55b8a1e-58b5-47f0-b954-fbad359103ef';
const REGION = 'sae1.pure.cloud';       
const REDIRECT_URI = window.location.origin + window.location.pathname;
const contactId = window.location.href.split('?contactId=')[1];
const campaignId = window.location.href.split('?campaignId=')[1];
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
		`&state=${encodeURIComponent(contactId || '')}`;

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
    interval: "2025-08-01T03:00:00.000Z/2025-08-31T03:00:00.000Z",
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
    const accessToken = localStorage.getItem('access_token');
    console.log("Antes: "+wrapups.notes);
    const resolvedCodes = await resolveWrapupCodesArray(wrapups.codes.split(", "), accessToken);

    console.log("Despues: "+wrapups.notes);
    return [
      fecha,
      tTalk,
      dnis,
      gridjs.html(`<span title="${resolvedCodes.join(", ")}">${resolvedCodes.join(", ")}</span>`),
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
      'Fecha (GMT-3)',
      'Duracion',
      'DNIS',
      'WrapUp Codes',
      'Agentes',
      'Notas'
    ],
    data: data,
    search: true,
    sort: true,
    pagination: { enabled: true, limit: 10 },
    resizable: true,
    language: {
      search: {
        placeholder: 'Buscar...'
      },
      pagination: {
        previous: 'Anterior',
        next: 'Siguiente',
        showing: 'Mostrando',
        results: () => 'registros'
      },
      loading: 'Cargando...',
      noRecordsFound: 'No se encontraron registros',
      error: 'Ocurrió un error al cargar los datos'
    }
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
  const totalSeconds = Math.floor(total / 1000); // redondeamos hacia abajo
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0 && seconds > 0) return `${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
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

async function resolveWrapupCodesArray(wrapUpCodes, accessToken) {
  const cache = new Map();
  const isId = (code) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);


  const uniqueCodes = [...new Set(wrapUpCodes.filter(isId))];

  const resolvedNames = await Promise.all(
    uniqueCodes.map(async (code) => {
      if (cache.has(code)) return cache.get(code);

      try {
        const response = await fetch(`https://api.${REGION}/api/v2/routing/wrapupcodes/${code}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const name = data.name || code;
        cache.set(code, name);
        return name;
      } catch (error) {
        console.error(`Error fetching wrapUpCode "${code}":`, error.message);
        cache.set(code, code); // fallback
        return code;
      }
    })
  );

  // Map de code → name
  const codeToName = Object.fromEntries(uniqueCodes.map((c, i) => [c, resolvedNames[i]]));

  // Devuelve array original con nombres reemplazados si están en cache
  return wrapUpCodes.map(code => codeToName[code] || code);
}


const urlParams = new URLSearchParams(window.location.search);

if (urlParams.has('code')) {
	const code = urlParams.get('code');
  const state = urlParams.get('state'); 
  localStorage.setItem('contactId', state);
  localStorage.setItem('campaingId(', state)
	exchangeCodeForToken(code)
		.then(() => {
			history.replaceState(null, '', REDIRECT_URI); // Limpia la URL
		})
		.catch(err => alert('Error en login: ' + err.message));
}

if (!window.__alreadyRan) {
	window.__alreadyRan = true;

	(async () => {
		const code = urlParams.get('code');
		if (!code) {
			await login(); // hace redirect
		} else {
      const contactId = localStorage.getItem('contactId');
      const campaignId = localStorage.getItem('campaignId');
			await getHistoryCalls(contactId);
      await getContactData(contactId, campaignId);
		}
	})();
}

//custom_-_6e654f5a-43e2-4fce-b590-ce54d40d2ec1
async function getContactData(contactId, campaignId){
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_6e654f5a-43e2-4fce-b590-ce54d40d2ec1"; 
  let body = {"contactId":contactId,"campaignId":campaignId}; 
  let opts = { 
    "flatten": false 
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
  .then((data) => {
    console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
    const editableFields = ['Direccion', 'Fecha Nacimiento', 'Telefono1', 'Telefono2'];
    const tableData = parseMarkdownTable(data['body.markdownTable']);
    renderEditableTable(tableData, editableFields);
    autocompleteForm(data);
  })
  .catch((err) => {
    console.log("There was a failure calling postIntegrationsActionExecute");
    console.error(err);
  });
}



  

function parseMarkdownTable(md) {
  const lines = md.trim().split('\n').slice(2); // quitamos cabecera y separadores
  const data = lines.map(line => {
    const parts = line.split('|').map(cell => cell.trim()).filter(Boolean);
    return parts;
  });
  return data;
}


function renderEditableTable(data, editableFields) {
  new gridjs.Grid({
    columns: [
      { name: 'Campo', sort: false },
      {
        name: 'Valor', sort: false,
        formatter: (cell, row) => {
          const campo = row.cells[0].data;
          if (editableFields.includes(campo)) {
            return gridjs.html(`
              <input type="text" 
                      value="${cell}" 
                      data-campo="${campo}" 
                      style="width:90%; padding:4px; border-radius:3px; border:1px solid #A7A8AA;" />
            `);
          }
          return cell;
        }
      }
    ],
    data: data,
    pagination: false,
    search: false,
    sort: false,
    style: {
      table: { fontSize: '0.9rem', width: '100%' },
      td: { padding: '6px 4px' },
      th: { backgroundColor: '#E6F2F9', color: '#0061A0', textAlign: 'left' }
    }
  }).render(document.getElementById('gridjs-table'));
}


function autocompleteForm(body) {
  const formMap = {
    nombres: body['body.nombre'] || '',
    apellidos: body['body.apellido'] || '',
    direccion: body['body.direccion'] || '',
    localidad: body['body.localidad'] || '',
    email: body['body.mail'] || '',
    fechaNacimiento: body['body.birthDate'] || '',
    telefono1: body['body.phoneValues']?.[0] || '',
    telefono2: body['body.phoneValues']?.[1] || '',
    telefono3: body['body.phoneValues']?.[2] || '',
  };

  Object.entries(formMap).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
}



