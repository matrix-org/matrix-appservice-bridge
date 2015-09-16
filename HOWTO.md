This How-To will explain how to write a **Matrix <--> Slack bridge**. You should be comfortable with:
 - REST/JSON APIs
 - Webhooks
 - Basic Node.js/JS tasks

# Setup a new project
Create a new directory and run `npm init` to generate a `package.json` file after answering some questions.
Run `npm install matrix-appservice-bridge` to install the bridge library, and `matrix-appservice` to install
the AS library. Create a file `index.js` which we'll use to write logic for the bridge.
```
$ npm init
$ npm install matrix-appservice-bridge
$ npm install matrix-appservice
$ touch index.js
```

# Slack-to-Matrix
First, we need to create an Outgoing WebHook in Slack (via the Integrations section). This will send
HTTP requests to us whenever a Slack user sends something in a slack channel. We'll monitor the channel
`#matrix` when sending outgoing webhooks rather than trigger words. Set the URL to a publically accessible
endpoint for your machine, or use something like [ngrok](https://ngrok.com/) if you're developing. We'll use
ngrok, and forward port `9898`.

Variables to remember:
 - Your monitored channel `$SLACK_CHAN`.
 - Your webhook url `$WEBHOOK_URL`.
 - Your listening port `$PORT`
 
## Printing out outbound slack requests
Open up `index.js` and write the following:
```javascript
var http = require("http");

http.createServer(function(request, response) {
    console.log(request.method + " " + request.url);

    var body = "";
    request.on("data", function(chunk) {
        body += chunk;
    });

    request.on("end", function() {
        console.log(body);
        response.writeHead(200, {"Content-Type": "application/json"});
        response.write(JSON.stringify({}));
        response.end();
    });
}).listen($PORT);  // replace me with your actual port number!
```

Send "hello world" in `$SLACK_CHAN` and it will print out something like this (pretty-printed):
```
POST /
token=53cr4t
&team_id=ABC123
&team_domain=yourteamname
&service_id=1234567890
&channel_id=AAABBCC
&channel_name=$SLACK_CHAN
&timestamp=1442409742.000006
&user_id=U3355223E
&user_name=alice
&text=hello+word
```


