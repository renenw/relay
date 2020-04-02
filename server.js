// node server.js

////////////////////////////////////// Init

const fs = require('fs');
const mkdirp = require('mkdirp');
// const request = require('request');
const os = require("os");

const DEVICE_NAME = process.env.DEVICE_NAME || os.hostname();
const GATEWAY = 'https://api.121.co.za/relay'
const API_KEY = process.env.AWS_API_KEY
const HOME_DIRECTORY = process.env.MESSAGE_DIRECTORY || '/var/iot_relay';
const HTTP_PORT = process.env.HTTP_PORT || 3553
const UDP_PORT = process.env.UDP_PORT || 54545

const IN = HOME_DIRECTORY + '/in'
const WIP = HOME_DIRECTORY + '/wip'
const RETRY = HOME_DIRECTORY + '/retry'
const DONE = HOME_DIRECTORY + '/done'

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
logString(`API endpoint: ${GATEWAY}`);

moveFiles(IN, RETRY);
moveFiles(WIP, RETRY);

setInterval(retry, 60000);
setInterval(uploadCounts, 60000);


////////////////////////////////////// UDP Submissions
const dgram = require('dgram');
const udp_server = dgram.createSocket('udp4');

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

const express = require('express');
const bodyParser = require('body-parser');

let http_server = express();
let jsonParser = bodyParser.json({ type: function() {return true;} });

http_server.set('port', HTTP_PORT);

// either receive input as a complete body (JSON, with a 'source' tag), or
// read the source from the query string.
http_server.post('/', jsonParser, (request,response)=>{
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

function write(data) {
  data.received = data.received || ((new Date()).getTime() / 1000.0);
  data.uid = (data.uid || data.received + '.' + Math.floor(Math.random()*100000000));;
  let fileName = IN + '/' + data.uid;
  fs.writeFile(fileName, JSON.stringify(data), (err)=>{ if (err) throw err; });
}


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
          postFile(filename, data);
        }
      });
  }
});


////////////////////////////////////// Helper functions

function logString(s) {
  console.log(s)
}

function postFile(filename, data) {
  // request.post(GATEWAY, {timeout: 2000, body: data, headers: { 'x-api-key': API_KEY }}, function(err, response) {
  //   if (err || response && response.statusCode!==202) {
  //     console.log('Failed to relay ' + filename);
  //     console.log('Response: ' + (response && response.statusCode));
  //     console.log('Error: ' + err.message);
  //     postFailure(filename);
  //   } else {
  //     postSuccess(filename);
  //   }
  // });
}

function postSuccess(filename) {
  let directory = DONE + '/' + (new Date().toISOString().substring(0,10));
  mkdirp(directory, (err, made) => { moveFile(WIP, filename, directory) });
  successes = successes + 1;
}

function postFailure(filename) {
  moveFile(WIP, filename, RETRY);
  failures = failures + 1;
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