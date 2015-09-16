This How-To will explain how to write a **Matrix <--> Slack bridge**. You should be comfortable with:
 - REST/JSON APIs
 - Webhooks
 - Basic Node.js/JS tasks

You need to have:
 - A working homeserver install
 - `npm` and `nodejs`

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
We'll be interested in the `user_name`, `text` and `channel_name`.

## Registering as an application service
We now want to do a lot more than just print out a POST request. We need to be able to *register* as
an application service, listen and handle incoming Matrix requests and expose a nice CLI to use.
Open up `index.js` and add this at the bottom of the file:
```javascript
var Cli = require("matrix-appservice-bridge").Cli;
var Bridge = require("matrix-appservice-bridge").Bridge;
var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
var bridge;

new Cli({
    registrationPath: "slack-registration.yaml",
    generateRegistration: function(appServiceUrl, callback) {
        var reg = new AppServiceRegistration(appServiceUrl);
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("slackbot");
        reg.addRegexPattern("users", "@slack_.*", true);
        callback(reg);
    },
    run: function(port, config) {
        // we will do this later
    }
}).run();
```

This will setup a CLI via the `Cli` class, which will dump the registration file to
`slack-registration.yaml`. It will register the user ID `@slackbot:domain` and ask
for exclusive rights (so no one else can create them) to the namespace of users with
the prefix `@slack_`. It also generates two tokens which will be used for authentication.

Now type `node index.js -r -u "http://localhost:9000"` (the URL is the URL that the
homeserver will try to use to communicate with the application service) and a file
`slack-registration.yaml` will be produced. In your Synapse install, edit 
`homeserver.yaml` to include this file:
```yaml
app_service_config_files: ["/path/to/slack/bridge/slack-registration.yaml"]
```
Then restart your homeserver. Your application service is now registered.

## Sending messages to Matrix
We need to have a `bridge` to send messages from, so in the `run: function(port, config)` method,
type the following:
```javascript
bridge = new Bridge({
    homeserverUrl: "http://localhost:8008",
    domain: "localhost",
    registration: "slack-registration.yaml",
    controller: {
        onUserQuery: function(queriedUser) {
            return {}; // auto-provision users with no additonal data
        },

        onEvent: function(request, context) {
            return; // we will handle incoming matrix requests later
        }
    }
});
console.log("Matrix-side listening on port %s", port);
bridge.run(port, config);
```
**NB: Make sure that the `bridge` variable is declared in the global scope, as we will be using it in
another function shortly.**

This configures the bridge to try to communicate with the homeserver at `http://localhost:8008`
using the information from the registration file `slack-registration.yaml`. We now need to use
the bridge to send the message we were printing our from slack earlier. Instead of
`console.log(body)` in `request.on("end", function() {`, replace that with the following:
```javascript

```


