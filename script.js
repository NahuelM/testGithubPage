const platformClient = require('purecloud-platform-client-v2');
const config = require('./config.txt');
const client = platformClient.ApiClient.instance;

exports.handler = async (event) => {
  try {
    client.setEnvironment(platformClient.PureCloudRegionHosts.sa_east_1);

    await client.loginClientCredentialsGrant(
      process.env.PURECLOUD_CLIENT_ID,
      process.env.PURECLOUD_CLIENT_SECRET
    );

		const callback = await getCallbacks(event.userId);
    return callback;
  } catch (err) {
    console.error("Error en el handler:", err);
    throw err;
  }
};


async function getCallbacks(userId){
	const apiInstance = new platformClient.AnalyticsApi();
	query = {
  "order": "desc",
  "orderBy": "conversationStart",
  "paging": {
    "pageNumber": 1,
    "pageSize": 50
  },
  "interval": "2025-07-01T03:00:00.000Z/2025-07-31T03:00:00.000Z",
  "segmentFilters": [
    {
      "type": "and",
      "predicates": [
        {
          "dimension": "mediaType",
          "value": "callback"
        },
        {
          "dimension": "segmentType",
          "value": "Scheduled"
        },
        {
          "dimension": "segmentEnd",
          "operator": "notExists"
        }
      ]
    },
    {
      "type": "or",
      "predicates": [
        {
          "dimension": "scoredAgentId",
          "value": userId
        }
      ]
    }
  ],
  "conversationFilters": []
	}
	try {
		const data = await apiInstance.postAnalyticsConversationsDetailsQuery(query);
		return data;
	}catch (err) {
		console.error(`Error en intervalo`, err);
		throw err;
	}
}

exports.rescheduleCallback = async(event) =>{
	client.setEnvironment(platformClient.PureCloudRegionHosts.sa_east_1);

	await client.loginClientCredentialsGrant(config.clientId, config.clientSecret);
	let apiInstance = new platformClient.ConversationsApi();
	const body = {
		"conversationId": event.conversationId,
		"callbackScheduledTime": getNewDate()
	}
	apiInstance.patchConversationsCallbacks(body)
	.then((data)=>{
		console.log(`patchConversationsCallbacks success! data: ${JSON.stringify(data, null, 2)}`);
	}).catch((err) => {
    console.log("There was a failure calling patchConversationsCallbacks");
    console.error(err);
  });
}

function getNewDate() {
  const ahora = new Date();
  // Convertir a equivalente de Montevideo (GMT-3)
  const offsetUruguayEnMs = -3 * 60 * 60 * 1000;
  const horaMontevideo = new Date(ahora.getTime());
  const nuevaHoraMontevideo = new Date(horaMontevideo.getTime() + 10 * 1000);

  return nuevaHoraMontevideo.toISOString();
}

// exports.handler({userId:"82b56df4-a946-4ce8-8412-b53721b40882"})
// .then(res => console.log(res)).catch(console.error);


exports.rescheduleCallback({conversationId:"11246325-190d-457d-bc2a-5d6c795d9289"})
.then(res => console.log(res)).catch(console.error);