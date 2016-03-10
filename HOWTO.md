This How-To will explain how to write a basic **Matrix <--> Slack bridge** in under 100 lines of code. You should be comfortable with:
 - REST/JSON APIs
 - Webhooks
 - Basic Node.js/JS tasks

You need to have:
 - A working homeserver install
 - `npm` and `nodejs`

NB: This how-to refers to the binary `node` - this may be `nodejs` depending on your distro.

# Setup a new project
Create a new directory and run `npm init` to generate a `package.json` file after answering some questions.
Run `npm install matrix-appservice-bridge` to install the bridge library, `request` to make sending HTTP
requests easier and `matrix-appservice` to install the AS library. Create a file `index.js` which we'll
use to write logic for the bridge.
```
$ npm init
$ npm install matrix-appservice-bridge
$ npm install request
$ touch index.js
```

# Slack-to-Matrix
First, we need to create an Outgoing WebHook in Slack (via the Integrations section). This will send
HTTP requests to us whenever a Slack user sends something in a slack channel. We'll monitor the channel
`#matrix` when sending outgoing webhooks rather than trigger words. Set the URL to a publically accessible
endpoint for your machine, or use something like [ngrok](https://ngrok.com/) if you're developing. We'll use
ngrok, and forward port `$PORT`.

Variables to remember:
 - Your monitored channel `$SLACK_CHAN`.
 
## Printing out outbound slack requests
Open up `index.js` and write the following:
```javascript
var http = require("http");
var qs = require("querystring"); // we will use this later
var requestLib = require("request"); // we will use this later
var bridge; // we will use this later

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
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;

new Cli({
    registrationPath: "slack-registration.yaml",
    generateRegistration: function(reg, callback) {
        reg.setId(AppServiceRegistration.generateToken());
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
run: function(port, config) {
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
})
```

This configures the bridge to try to communicate with the homeserver at `http://localhost:8008`
using the information from the registration file `slack-registration.yaml`. We now need to use
the bridge to send the message we were printing out from slack earlier. Just like how the Slack
room is hard-coded to `$SLACK_CHAN`, we'll hard-code the room ID to send to. Create a new public
room on Matrix, which has the room ID `$ROOM_ID`.

NB: You can do this as an invite-only room on Matrix, but you *MUST* invite the slack AS bridge
user (`@slackbot:domain`) to the room so it can invite virtual slack users. 

Replace the function `request.on("end", function()`, with the following:
```javascript
request.on("end", function() {
    var params = qs.parse(body);
    if (params.user_id !== "USLACKBOT") {
        var intent = bridge.getIntent("@slack_" + params.user_name + ":localhost");
        intent.sendText(ROOM_ID, params.text);
    }
    response.writeHead(200, {"Content-Type": "application/json"});
    response.write(JSON.stringify({}));
    response.end();
});
```

We filter out `USLACKBOT` to avoid showing duplicate messages when we do the reverse (sending to
slack from an inbound webhook). `qs.parse` is used to convert the POST string into a JSON object.
The `Intent` object obtained from the bridge is scoped to a slack user ID specified in `getIntent`.
This means that `sendText` will be sent as the `@slack_<user_name>:localhost` entity.

Then run the application service with `node index.js -p 9000` and send a message from Slack. It
should then be passed through to the specified matrix room!

# Matrix-to-Slack
First, you need to create an Incoming WebHook under the Integrations section. You'll need to
remember your allocated webhook url: `$WEBHOOK_URL`.

Replace the `onEvent: function(request, context)` function created earlier with:
```javascript
onEvent: function(request, context) {
    var event = request.getData();
    // replace with your room ID
    if (event.type !== "m.room.message" || !event.content || event.room_id !== $ROOM_ID) {
        return;
    }
    requestLib({
        method: "POST",
        json: true,
        uri: $WEBHOOK_URL, // replace with your url!
        body: {
            username: event.user_id,
            text: event.content.body
        }
    }, function(err, res) {
        if (err) {
            console.log("HTTP Error: %s", err);
        }
        else {
            console.log("HTTP %s", res.statusCode);
        }
    });
}
```

Run the app service with `node index.js -p 9000` and send a message to the Matrix room and that
message will be relayed to the specified slack room. That's it!

# Full source

```javascript
// Usage:
// node index.js -r -u "http://localhost:9000" # remember to add the registration!
// node index.js -p 9000
var http = require("http");
var qs = require('querystring');
var requestLib = require("request");
var bridge;
var PORT = 9898; // slack needs to hit this port e.g. use "ngrok 9898"
var ROOM_ID = "!YiuxjYhPLIZGVVkFjT:localhost"; // this room must have join_rules: public
var SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/AAAA/BBBBB/CCCCC";

http.createServer(function(request, response) {
    console.log(request.method + " " + request.url);

    var body = "";
    request.on("data", function(chunk) {
        body += chunk;
    });

    request.on("end", function() {
        var params = qs.parse(body);
        if (params.user_id !== "USLACKBOT") {
            var intent = bridge.getIntent("@slack_" + params.user_name + ":localhost");
            intent.sendText(ROOM_ID, params.text);
        }
        response.writeHead(200, {"Content-Type": "application/json"});
        response.write(JSON.stringify({}));
        response.end();
    });
}).listen(PORT);

var Cli = require("matrix-appservice-bridge").Cli;
var Bridge = require("matrix-appservice-bridge").Bridge;
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;

new Cli({
    registrationPath: "slack-registration.yaml",
    generateRegistration: function(reg, callback) {
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("slackbot");
        reg.addRegexPattern("users", "@slack_.*", true);
        callback(reg);
    },
    run: function(port, config) {
        bridge = new Bridge({
            homeserverUrl: "http://localhost:8008",
            domain: "localhost",
            registration: "slack-registration.yaml",

            controller: {
                onUserQuery: function(queriedUser) {
                    return {}; // auto-provision users with no additonal data
                },

                onEvent: function(request, context) {
                    var event = request.getData();
                    if (event.type !== "m.room.message" || !event.content || event.room_id !== ROOM_ID) {
                        return;
                    }
                    requestLib({
                        method: "POST",
                        json: true,
                        uri: SLACK_WEBHOOK_URL,
                        body: {
                            username: event.user_id,
                            text: event.content.body
                        }
                    }, function(err, res) {
                        if (err) {
                            console.log("HTTP Error: %s", err);
                        }
                        else {
                            console.log("HTTP %s", res.statusCode);
                        }
                    });
                }
            }
        });
        console.log("Matrix-side listening on port %s", port);
        bridge.run(port, config);
    }
}).run();
```

# Configuration
So far in this example we have hard-coded various items of information that would be
considered "configuration"; namely the Slack outbound webhook token and the list of room
mappings to bridge. We can use the `ConfigValidator` to help parse a configuration file
at startup time to obtain this information from instead.

Start by defining a schema file that describes what the YAML config file can contain.
This is also a YAML file in the JSON Schema format. Store this in a file called
`slack-config-schema.yaml`:

```yaml
type: object
requires: ["slack_webhook_url"]
properties:
    slack_webhook_url:
        type: string
```

If we supply the name of this schema file to the constructor of the main `Cli` object
then it will use this to validate a config file that the user passes on the
command line. The markup that this config file provides will be parsed and presented
as the `config` parameter to the main `run` function.

```javascript
new Cli({
    registrationPath: "slack-registration.yaml",
    generateRegistration: function(reg, callback) {
        ...
    },
    bridgeConfig: {
        schema: "slack-config-schema.yaml"
    },
    run: function(port, config) {
        var slack_webhook_url = config.slack_webhook_url;
        ...
```

# Extensions
 - The code to process the Slack POST request does not include any limits on the upload size.
