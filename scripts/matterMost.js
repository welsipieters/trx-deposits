const axios = require('axios');

async function sendMattermostAlert(message) {
    const bearer_token = "rjx4h6r8mi8pim91bg3ok3ecde";
    const channel_id = "yjo535moaiy55no3afzjqaqbca";
    const mattermost_url = "https://matter.knaken.eu/api/v4/posts";

    const payload = {
        channel_id: channel_id,
        message: message,
    };

    try {
        const response = await axios.post(mattermost_url, payload, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${bearer_token}`
            }
        });

        console.log(`${new Date().toISOString()} - Melding gemaakt naar Mattermost\n\n`);
    } catch (error) {
        console.error('Error sending alert to Mattermost:', error);
    }
}


module.exports = sendMattermostAlert