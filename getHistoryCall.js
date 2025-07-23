const CLIENT_ID = 'a55b8a1e-58b5-47f0-b954-fbad359103ef';
const REGION = 'sae1.pure.cloud';       
const REDIRECT_URI = window.location.origin + window.location.pathname;

const contactId = 'e9b9652fc0d631a923250621708396fd';

const client = platformClient.ApiClient.instance;

client.setEnvironment(region);
client.loginOAuthCodePKCE(CLIENT_ID, REDIRECT_URI)
  .then(() => getHistoryCalls(contactId))
  .catch(err => {
    document.getElementById("tabla").innerText = "Error en login: " + err;
    console.error(err);
  });

async function getHistoryCalls(contactId) {
  const api = new platformClient.AnalyticsApi();
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(now.getMonth() - 6);
  const interval = `${sixMonthsAgo.toISOString()}/${now.toISOString()}`;

  const query = {
    order: "desc",
    orderBy: "conversationStart",
    paging: { pageSize: 50, pageNumber: 1 },
    interval: interval,
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
