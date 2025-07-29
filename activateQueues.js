const CLIENT_ID = 'a55b8a1e-58b5-47f0-b954-fbad359103ef';
const REGION = 'sae1.pure.cloud';
const REDIRECT_URI = window.location.origin + window.location.pathname;

const client = platformClient.ApiClient.instance;
client.setEnvironment(REGION);
let codeVerifier = localStorage.getItem('code_verifier');

async function login() {
  codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem('code_verifier', codeVerifier);

  const url = `https://login.${REGION}/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
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
    throw new Error('Error al obtener token: ' + JSON.stringify(data));
  }
}

function generateCodeVerifier() {
  const array = new Uint32Array(56);
  window.crypto.getRandomValues(array);
  return btoa(Array.from(array, dec => String.fromCharCode(dec % 256)).join('')).replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('code')) {
    const token = await exchangeCodeForToken(urlParams.get('code'));
    client.setAccessToken(token);
    history.replaceState(null, '', REDIRECT_URI);
    startApp();
  } else {
    await login();
  }
}

async function startApp() {
  const usersApi = new platformClient.UsersApi();
  const routingApi = new platformClient.RoutingApi();

  const me = await usersApi.getUsersMe();
  const userId = me.id;

  document.getElementById("user-info").innerText = `Usuario: ${me.name}`;
  let opts = { 
  	"pageSize": 25,
  	"pageNumber": 1
	};

  const queues = await routingApi.getUserQueues(userId, opts);
  let activeQueue = queues.entities.find(q => q.joined);
  const inactiveQueues = queues.entities.filter(q => !q.joined);

	renderQueueList('active-queues', activeQueue ? [activeQueue] : [], 'Desactivar', async (queue) => {
		await routingApi.patchRoutingUserQueues(userId, [
			{ id: queue.id, joined: false }
		], {});
		startApp();
	});

	renderQueueList('inactive-queues', inactiveQueues, 'Activar', async (queue) => {
		const patchBody = [];
		if (activeQueue) {
			patchBody.push({ id: activeQueue.id, joined: false });
		}
		patchBody.push({ id: queue.id, joined: true });

		await routingApi.patchRoutingUserQueues(userId, patchBody, {});
		startApp();
	});
}

function renderQueueList(containerId, queues, buttonText, buttonHandler) {
  const ul = document.getElementById(containerId);
  ul.innerHTML = "";
  queues.forEach(queue => {
    const li = document.createElement('li');
    li.textContent = queue.name;
    const btn = document.createElement('button');
    btn.textContent = buttonText;
    btn.onclick = () => buttonHandler(queue);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

init();
