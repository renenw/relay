////////////////////////////////////// Init

const fs = require('fs');
const mkdirp = require('mkdirp');
const os = require("os");
const datagram = require('dgram');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mqtt = require('mqtt');

const DEVICE_NAME = process.env.DEVICE_NAME || os.hostname();
const MQTT_BROKER = process.env.MQTT_BROKER;
const GATEWAY = process.env.GATEWAY // || 'https://relay.free.beeceptor.com'
const API_KEY = process.env.API_KEY || ''
const HOME_DIRECTORY = process.env.MESSAGE_DIRECTORY || '/var/iot_relay';
const HTTP_PORT = process.env.HTTP_PORT || 3553
const UDP_PORT = process.env.UDP_PORT || 54545

const IN = HOME_DIRECTORY + '/in'
const WIP = HOME_DIRECTORY + '/wip'
const RETRY = HOME_DIRECTORY + '/retry'
const DONE = HOME_DIRECTORY + '/done'

const http_post_options = {
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json'
  }
}

let failures = 0;
let successes = 0;

mkdirp.sync(IN);
mkdirp.sync(WIP);
mkdirp.sync(RETRY);
mkdirp.sync(DONE);


////////////////////////////////////// Startup

logString(`Starting: ${DEVICE_NAME}`);
logString(`HTTP on ${HTTP_PORT}`);
logString(`UDP on ${UDP_PORT}`);
logString(`Working directory: ${HOME_DIRECTORY}`);

if (GATEWAY) {
  logString(`API endpoint: ${GATEWAY}`);
} else {
  logString('API endpoint not defined. Messages will not be posted to an API Gateway');
}

if (MQTT_BROKER) {
  logString(`MQTT broker: ${MQTT_BROKER}`);
} else {
  logString('MQTT broker not defined. Messages will not be published to MQTT.');
}

let mqttClient = null;
if (MQTT_BROKER) { mqttClient = mqtt.connect(`mqtt://${MQTT_BROKER}`); }

moveFiles(IN, RETRY);
moveFiles(WIP, RETRY);

setInterval(retry, 60000);
setInterval(uploadCounts, 60000);


////////////////////////////////////// UDP Submissions

const udp_server = datagram.createSocket('udp4');

udp_server.on('error', (err) => {
  logString(`udp_server error:\n${err.stack}`);
  udp_server.close();
});

udp_server.on('message', (message, rinfo) => {
  logString(`udp_server got: ${message} from ${rinfo.address}:${rinfo.port}`);
  let udp_message = message.toString();
  let index = udp_message.indexOf(' ');
  let source = udp_message.substring(0, index).trim();
  let payload = udp_message.substr(index + 1).trim();
  write( { source: source, payload: payload } );
});

udp_server.on('listening', () => {
  const address = udp_server.address();
  logString(`UDP listener listening on ${address.address}:${address.port}`);
});

udp_server.bind(UDP_PORT);


////////////////////////////////////// Web Posts

let http_server = express();
let jsonParser = bodyParser.json({ type: function() {return true;} });

http_server.set('port', HTTP_PORT);

// either receive input as a complete body (JSON, with a 'source' tag), or
// read the source from the query string.
http_server.post('/', jsonParser, (request,response)=>{
  logString(`http_server POST from ${request.ip}`);
  let code = 202;
  if (request.body['source']) {
    write(request.body);
  } else if (request.query['source']) {
    write( { source: request.query['source'], payload: request.body } );
  } else {
    code = 400;
  }
  response.status(code).end();
});

// allow submission using get request and query string
http_server.get('/', (request,response)=>{
  logString(`http_server GET from ${request.ip}`);
  let code = 202;
  if (request.query['source']) {
    write(request.query);
  } else {
    code = 400;
  }
  response.status(code).end();
});

http_server.listen(http_server.get('port'), ()=>{
  logString('HTTP listener started on port ' + http_server.get('port'));
});


////////////////////////////////////// File System watcher

let watch_in = fs.watch(IN);

watch_in.on('change', function name(event, filename) {
  if (event==='change') { moveFile(IN, filename, WIP) };
});

let watch_wip = fs.watch(WIP);

watch_wip.on('change', function name(event, filename) {
  let sourceFile = WIP + '/' + filename;
  if (fs.existsSync(sourceFile)) {
    fs.readFile(sourceFile, 'utf8', (err, data) => {
        if (err) {
          logString('Unable to read file: ' + err);
        } else {
          let failed = true;
          try {
            if (mqttClient) { postMqtt(data) };
            if (GATEWAY) { postFile(filename, data) };
            failed = false;
          } catch(error) {
            logString('Failed to relay ' + filename);
            logString(error);
          }
          if (failed) {
            postFailure(filename);
          } else {
            postSuccess(filename);
          }
        }
      });
  }
});


////////////////////////////////////// MQTT

function postMqtt(data) {
  json = JSON.parse(data);
  mqttClient.publish(json.source, JSON.stringify(json.payload));
}

////////////////////////////////////// Uploader

function postFile(filename, data) {
  axios.post(GATEWAY, data, http_post_options)
  .then((res) => {
    let awsRequestId = res.headers['x-amzn-requestid'];
    console.log(awsRequestId ? `Uploaded. Request ID: ${awsRequestId}` : 'Uploaded. No request id.')
  });
}

function postSuccess(filename) {
  let directory = DONE + '/' + (new Date().toISOString().substring(0,10));
  mkdirp.sync(directory);
  moveFile(WIP, filename, directory);
  successes = successes + 1;
}

function postFailure(filename) {
  moveFile(WIP, filename, RETRY);
  failures = failures + 1;
}




////////////////////////////////////// Helper functions

function logString(s) {
  console.log(s)
}

function write(data) {
  data.received = data.received || ((new Date()).getTime() / 1000.0);
  data.uid = (data.uid || data.received + '.' + Math.floor(Math.random()*100000000));;
  let fileName = IN + '/' + data.uid;
  fs.writeFile(fileName, JSON.stringify(data), (err)=>{ if (err) throw err; });
}

function moveFile(fromDirectory, filename, toDirectory) {
  fs.rename(fromDirectory + '/' + filename, toDirectory + '/' + filename, (err) => {
    if (err) { console.log('Failed to move ' + fromDirectory + '/' + filename + ' to ' + toDirectory + ': ' + err);  }
  });
}

function moveFiles(fromDirectory, toDirectory) {
  let files = fs.readdirSync(fromDirectory);
  for (let i = 0; i < files.length; i++) {
    fs.rename(fromDirectory + '/' + files[i], toDirectory + '/' + files[i], (err) => { if (err) { console.log('Unable to move to retry queue: ' + err.message); }});
  }
}

function retry() {
  moveFiles(RETRY, WIP);
}

function uploadCounts() {
  write({
          source: DEVICE_NAME,
          payload: {
              successes: successes,
              failures: failures
        }
  });
  successes = 0;
  failures = 0;
}