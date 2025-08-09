const CLIENT_ID = 'a55b8a1e-58b5-47f0-b954-fbad359103ef';
const REGION = 'sae1.pure.cloud';       
const REDIRECT_URI = window.location.origin + window.location.pathname;
// const contactId = window.location.href.split('?contactId=')[1];
// const campaignId = window.location.href.split('?campaignId=')[1];
const client = platformClient.ApiClient.instance;

let codeVerifier = localStorage.getItem('code_verifier');
client.setEnvironment(REGION);
async function login() {
  codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem('code_verifier', codeVerifier);

  // Armamos el state como query string
  const contactId = urlParams.get('contactId') || '';
  const campaignId = urlParams.get('campaignId') || '';
  const participantId = urlParams.get('participantId') || '';
  const conversationId = urlParams.get('conversationId') || '';
  const scriptId = urlParams.get('scriptId') || '';
  const userId =  urlParams.get('userId') || '';
  const userName =  urlParams.get('userName') || '';
  const queueId =  urlParams.get('queueId') || '';


  const stateObj = new URLSearchParams();
  if (contactId) stateObj.append('contactId', contactId);
  if (campaignId) stateObj.append('campaignId', campaignId);
  if (participantId) stateObj.append('participantId', participantId);
  if (scriptId) stateObj.append('scriptId', scriptId);
  if (conversationId) stateObj.append('conversationId', conversationId);
  if (userId) stateObj.append('userId', userId);
  if (userName) stateObj.append('userName', userName);
  if (queueId) stateObj.append('queueId', queueId);
  
  
  // Podés agregar más parámetros al state así:
  // stateObj.append('userType', 'cliente');

  const state = encodeURIComponent(stateObj.toString());

  const url = `https://login.${REGION}/oauth/authorize?` +
    `client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256` +
    `&state=${state}`;

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
const code = urlParams.get('code');
const rawState = urlParams.get('state');

if (code && rawState) {
  const stateParams = new URLSearchParams(decodeURIComponent(rawState));
  for (const [key, value] of stateParams.entries()) {
    localStorage.setItem(key, value); // guarda contactId, campaignId, o cualquier otro
  }

  exchangeCodeForToken(code)
    .then(() => {
      history.replaceState(null, '', REDIRECT_URI); // limpia los parámetros de la URL
    })
    .catch(err => alert('Error en login: ' + err.message));
}

if (!window.__alreadyRan) {
  window.__alreadyRan = true;

  (async () => {
    if (!code) {
      await login(); 
    } else {
      const contactId = localStorage.getItem('contactId');
      const campaignId = localStorage.getItem('campaignId');
      const userId = localStorage.getItem("userId")
      await getHistoryCalls(contactId);
      await getContactData(contactId, campaignId);
      await getWrapUpCodes("*");
      await getUsersByDivision("Home");
      suscribirseATopic(userId);
    }
  })();
}

document.getElementById('Tipificar').onclick = (e) => {
  e.preventDefault(); 
  const conversationId = localStorage.getItem('conversationId');
  const participantId = localStorage.getItem('participantId');

  const select = document.getElementById('wrapup');
  const wrapupCode = select.value;
  const wrapupName = select.options[select.selectedIndex].text;

  const note = document.getElementById("notes");
  if(globalCommunicationId === null)
    tipificar(conversationId, participantId, wrapupCode, wrapupName, note.value);
  else tipificarInCall(conversationId, participantId, globalCommunicationId, wrapupCode, wrapupName, note.value);
};

document.getElementById('Callback').onclick = (e) => {
  e.preventDefault(); 
  createCallbackGateway();
}
  
function createCallbackGateway(){
  let userId = localStorage.getItem('userId');
  let userName = localStorage.getItem('userName');
  const queueId = localStorage.getItem('queueId');
  const scriptId = localStorage.getItem('scriptId');
  const campaignId = localStorage.getItem('campaignId');
  const contactId = localStorage.getItem('contactId');
  const conversationId = localStorage.getItem('conversationId');
  const participantId = localStorage.getItem('participantId');
  const datePicker = document.getElementById("callback-datetime");

  const checkboxOwner = document.getElementById("checkboxOwner");

  if (checkboxOwner.checked) {
    const dropDown = document.getElementById("AgenteCall");
    userId = dropDown.value;
    userName = dropDown.options[dropDown.selectedIndex].text;
  }
  createCallback(userId, userName, queueId, datePicker.value, scriptId, PhoneNumbers, campaignId, contactId, ContactName, conversationId, participantId);
}

document.getElementById("AgenteCall").style.display = "none";
document.getElementById("checkboxOwner").onclick = () => {
  const dropDown = document.getElementById("AgenteCall");
  const checkbox = document.getElementById("checkboxOwner");

  dropDown.style.display = checkbox.checked ? "block" : "none";
};

document.getElementById("ventaButton").onclick = () =>{
  e.preventDefault();
  const conversationId = localStorage.getItem('conversationId');
  const participantId = localStorage.getItem('participantId'); //deberia ser el participantID del customer
  addInfoVenta(conversationId, participantId, ventaData);
  addTagVenta(conversationId, "Venta");

}

let PhoneNumbers = ""
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
    console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data.body, null, 2)}`);
    const editableFields = ['Direccion', 'Fecha Nacimiento', 'Telefono1', 'Telefono2', 'TelefonoObtenido', 'Auxiliar'];
    const tableData = parseMarkdownTable(data.body.markdownTable);

    PhoneNumbers = (data.body.phoneValues || [])
      .filter(p => p && p.trim() !== "")
      .join(", ");

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
  const container = document.getElementById('gridjs-table');
  container.innerHTML = ''; // Limpia antes de renderizar

  new gridjs.Grid({
    columns: [
      { name: 'Campo', sort: false },
      {
        name: 'Valor', sort: false,
        formatter: (cell, row) => {
          const campo = row.cells[0].data;
          const isEditable = editableFields.includes(campo) || campo === 'TelefonoObtendio';

          if (isEditable) {
            return gridjs.html(`
              <input type="text" 
                     value="${cell}" 
                     data-campo="${campo}" 
                     style="width:90%; padding:4px; border-radius:3px; border:1px solid #A7A8AA;" />
            `);
          }

          return cell;
        }
      },
      {
        id: 'boton',
        name: '', // sin header visible
        sort: false,
        formatter: (_, row) => {
          const campo = row.cells[0].data;
          if (campo === 'TelefonoObtendio') {
            return gridjs.html(`
              <button onclick="accionTelefonoObtendio()" 
                      style=" border: none; cursor: pointer; padding: 4px;">
                <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92V21a2 2 0 0 1-2.18 2A19.72 19.72 0 0 1 3 5.18 2 2 0 0 1 5 3h4.09a1 1 0 0 1 1 .75l1.38 5.52a1 1 0 0 1-.27.95L9.91 12.09a16 16 0 0 0 6 6l1.87-1.87a1 1 0 0 1 .95-.27l5.52 1.38a1 1 0 0 1 .75 1z"/>
                </svg>
              </button>
            `);
          }
          return ''; // celda vacía para los demás campos
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
  }).render(container);
}

function accionTelefonoObtendio() {
  const input = document.querySelector('input[data-campo="TelefonoObtendio"]');
  if (input) {
    const phone = input.value;
    let apiInstance = new platformClient.ConversationsApi();

    let conversationId = localStorage.getItem("conversationId");
    let body = {
      "callNumber": phone,
      "phoneColumn": "telefono obtenido"
    };

    apiInstance.postConversationsCall(conversationId, body)
      .then((data) => {
        console.log(`postConversationsCall success! data: ${JSON.stringify(data, null, 2)}`);
      })
      .catch((err) => {
        console.log("There was a failure calling postConversationsCall");
        console.error(err);
      });
    }
}


let ContactName = "customer";

function autocompleteForm(body) {
  ContactName = (body.nombre || '') + " " + (body.apellido || '');

  const formMap = {
    nombres: body.nombre,
    apellidos: body.apellido,
    direccion: body.direccion,
    localidad: body.localidad,
    email: body.email,
    fechaNacimiento: body.fechaNacimiento,
    telefono1: body.phoneValues?.[0],
    telefono2: body.phoneValues?.[1],
    telefono3: body.phoneValues?.[2],
    telefono4: body.phoneValues?.[3],
  };

  Object.entries(formMap).forEach(([id, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      const el = document.getElementById(id);
      if (el) {
        if (el.tagName.toLowerCase() === 'select') {
          el.value = value;
        } else {
          el.value = value;
        }
      }
    }
  });
}


//custom_-_d6f14107-797f-4ca2-bff9-107facd56f89
function tipificar(conversationId, participantId, wrapupCode, wrapupName, note) {
  if(wrapupName !== "Apertura de deposito" && fechaCallbackVacio){
    let apiIntegration = new platformClient.IntegrationsApi();
    let actionId = "custom_-_d6f14107-797f-4ca2-bff9-107facd56f89"; 
    let body = {"conversationId":conversationId,
                "participantId":participantId, 
                "wrapupCode":wrapupCode,
                "wrapupName":wrapupName,
                "note": note}; 
    let opts = { 
      "flatten": false 
    };

    apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
    .then((data) => {
      console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
    })
    .catch((err) => {
      console.log("There was a failure calling postIntegrationsActionExecute");
      console.error(err);
    });
  }
  else{
    //Mostrar mensje de que deben llenar callback
  }
}

//custom_-_b2112b56-f4f2-43b9-9d20-248029edcb7a
function tipificarInCall(conversationId, participantId, communicationId, wrapupCode, wrapupName, note){
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_b2112b56-f4f2-43b9-9d20-248029edcb7a"; 
  let body = {"conversationId":conversationId,
              "participantId":participantId, 
              "communicationId":communicationId,
              "wrapupCode":wrapupCode,
              "wrapupName":wrapupName,
              "note": note}; 
  let opts = { 
    "flatten": false 
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
  .then((data) => {
    console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
  })
  .catch((err) => {
    console.log("There was a failure calling postIntegrationsActionExecute");
    console.error(err);
  });
}


//custom_-_6e05c5aa-46b4-468e-a3d6-24e6768ae4c1
async function getWrapUpCodes(divisionId) {
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_6e05c5aa-46b4-468e-a3d6-24e6768ae4c1"; 
  let body = {"divisionId":divisionId}; 
  let opts = { 
    "flatten": true 
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
  .then((data) => {
    const wrapupSelect = document.getElementById('wrapup');
    wrapupSelect.innerHTML = '<option value="" disabled selected>Seleccione un Wrap-Up</option>'; // limpiar y dejar default

    const ids = data["entities.id"];
    const names = data["entities.name"];
    // Limpiar y dejar opción por defecto
    wrapupSelect.innerHTML = '<option value="" disabled selected>Seleccione un Wrap-Up</option>';

    if (Array.isArray(ids) && Array.isArray(names) && ids.length === names.length) {
      for (let i = 0; i < ids.length; i++) {
        const option = document.createElement('option');
        option.value = ids[i];
        option.textContent = names[i];
        wrapupSelect.appendChild(option);
      }
    } else {
      console.warn("Datos inconsistentes en los wrapups.");
    }
  })
  .catch((err) => {
    console.log("There was a failure calling postIntegrationsActionExecute");
    console.error(err);
  });
}

//custom_-_d0d53271-fbc5-43c9-9324-43935958a9d7
async function getUsersByDivision(divisionName) {
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_d0d53271-fbc5-43c9-9324-43935958a9d7"; 
  let body = {"divisionName":divisionName}; 
  let opts = { 
    "flatten": false 
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
  .then((data) => {
  const agentSelect = document.getElementById('AgenteCall');
  agentSelect.innerHTML = '<option value="" disabled selected>Seleccione un Agente</option>';

  const ids = data.usersData?.ids || [];
  const usernames = data.usersData?.usernames || [];

  if (Array.isArray(ids) && Array.isArray(usernames) && ids.length === usernames.length) {
    for (let i = 0; i < ids.length; i++) {
      const option = document.createElement('option');
      option.value = ids[i];          // ID como value
      option.textContent = usernames[i]; // username visible
      agentSelect.appendChild(option);
    }
  } else {
    console.warn('Datos inválidos en usersData');
}
  })
  .catch((err) => {
    console.log("There was a failure calling postIntegrationsActionExecute");
    console.error(err);
  });
}

//custom_-_98d17133-7edd-4813-a4d1-0b3200b90564
function createCallback(userId, userName, queueId, scheduleTime, scriptId, callbackNumbers, campaignId, contactId, contactName, conversationId, participantId){
  let apiIntegration = new platformClient.IntegrationsApi();

  let actionId = "custom_-_98d17133-7edd-4813-a4d1-0b3200b90564"; 
  let opts = { 
    "flatten": false 
  };
  let body = { 
    "userId": userId,
    "userName": userName,
    "queueId": queueId,
    "scheduleTime":scheduleTime,
    "scriptId": scriptId, 
    "callbackNumbers": callbackNumbers,
    "campaingId": campaignId, //ERROR ORTOGRAFICO; CAMBIAR!!!!!!!!
    "contactId": contactId,
    "contactName": contactName,
    "conversationId": conversationId,
    "participantId": participantId
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
    .then((data) => {
      console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
    })
    .catch((err) => {
      console.log("There was a failure calling postIntegrationsActionExecute");
      console.error(err);
  });
}

//custom_-_626033b8-85b8-4a23-8022-16b30ebc0b0c
function addInfoVenta(conversationId, participantId, ventaData){
  let apiIntegration = new platformClient.IntegrationsApi();
   let actionId = "custom_-_626033b8-85b8-4a23-8022-16b30ebc0b0c"; 
  let opts = { 
    "flatten": false 
  };
  let body = { 
    "conversationId": conversationId,
    "participantId": participantId,
    "ventaData": ventaData
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
    .then((data) => {
      console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
    })
    .catch((err) => {
      console.log("There was a failure calling postIntegrationsActionExecute");
      console.error(err);
  });
}

//custom_-_1a2d0adc-73e8-4313-a2ac-b2db841200b0
function addTagVenta(conversationId, tagName){
  let apiIntegration = new platformClient.IntegrationsApi();
  let actionId = "custom_-_1a2d0adc-73e8-4313-a2ac-b2db841200b0"; 
  let opts = { 
    "flatten": false 
  };
  let body = { 
    "conversationId": conversationId,
    "tagName": tagName
  };

  apiIntegration.postIntegrationsActionExecute(actionId, body, opts)
    .then((data) => {
      console.log(`postIntegrationsActionExecute success! data: ${JSON.stringify(data, null, 2)}`);
    })
    .catch((err) => {
      console.log("There was a failure calling postIntegrationsActionExecute");
      console.error(err);
  });
}


let globalCommunicationId = null;

function habilitarBoton(estado) {
  const button = document.getElementById("Tipificar");
  if (button) {
    button.disabled = estado;
    button.style.opacity = estado ? "1" : "0.5";  // Translucido cuando está deshabilitado
    button.style.cursor = estado ? "pointer" : "not-allowed";
  }
}

function procesarEvento(data) {
  if (!data.eventBody || !data.eventBody.participants) {
    console.warn("Mensaje sin eventBody o participants");
    habilitarBoton(false);
    return;
  }

  const participantes = data.eventBody.participants;

  let llamadaTerminada = false;
  let communicationId = null;

  for (const participante of participantes) {
    if (participante.purpose === "agent" || participante.purpose === "customer") {
      if (participante.calls && Array.isArray(participante.calls)) {
        for (const call of participante.calls) {
          if (call.state === "disconnected" /*|| call.state === "terminated"*/) {
            llamadaTerminada = true;
            communicationId = call.peerId || call.id || null;
            console.warn("COMUNICATION ID:  " + communicationId);
            break; // ya encontré un callback desconectado para este participante
          }
        }
      }
    }
    if (llamadaTerminada) break; // no necesito seguir buscando si ya la encontré
  }

  if (llamadaTerminada) {
    globalCommunicationId = communicationId;
    console.log("Llamada terminada, communicationId:", globalCommunicationId);
    habilitarBoton(true);
  } else {
    globalCommunicationId = null;
    habilitarBoton(false);
    console.log("Llamada no terminada o no encontrada");
  }
}

function suscribirseATopic(userId) {
  console.log("[suscribirseATopic] Iniciando suscripción para userId:", userId);

  const notificationsApi = new platformClient.NotificationsApi();

  // El topic debe ir entre comillas invertidas para que se evalúe la variable userId
  const topic = `v2.users.${userId}.conversations`;
  console.log("[suscribirseATopic] Topic a suscribirse:", topic);

  notificationsApi.postNotificationsChannels()
    .then(channel => {
      console.log("[suscribirseATopic] Canal creado:", channel);

      const websocket = new WebSocket(channel.connectUri);
      console.log("[suscribirseATopic] Conectando WebSocket a:", channel.connectUri);

      websocket.onopen = () => {
        console.log("[WebSocket] Conexión abierta ✅");
      };

      websocket.onerror = err => {
      };

      websocket.onclose = () => {
        console.warn("[WebSocket] Conexión cerrada ⚠️");
      };

      websocket.onmessage = function(event) {
        console.log("[WebSocket] Mensaje recibido:", event.data);
        const data = JSON.parse(event.data);
        procesarEvento(data);
      };

      // Suscribirse al topic
      return notificationsApi.postNotificationsChannelSubscriptions(channel.id, [{ id: topic }])
        .then(() => {
          console.log("[suscribirseATopic] Suscripción al topic exitosa ✅");
        })
        .catch(err => {
          console.error("[suscribirseATopic] Error al suscribirse al topic ❌", err);
        });

    })
    .catch(err => {
      console.error("[suscribirseATopic] Error al crear canal ❌", err);
    });
}
