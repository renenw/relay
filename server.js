// node server.js

////////////////////////////////////// Init

let fs = require('fs');
let mkdirp = require('mkdirp');
var request = require('request');

const GATEWAY = 'https://api.121.co.za/relay'

const API_KEY = 'pt4iaFfL0G3yi8e7CYJWYbs79YrPFpX5WhePwDDb'

const HOME_DIRECTORY = process.env.MESSAGE_DIRECTORY || '/var/iot_relay';
const IN = HOME_DIRECTORY + '/in'
const WIP = HOME_DIRECTORY + '/wip'
const RETRY = HOME_DIRECTORY + '/retry'
const DONE = HOME_DIRECTORY + '/done'

mkdirp.sync(IN);
mkdirp.sync(WIP);
mkdirp.sync(RETRY);
mkdirp.sync(DONE);

////////////////////////////////////// Startup

moveFiles(IN, RETRY);
moveFiles(WIP, RETRY);

setInterval(retry, 60000);

////////////////////////////////////// Web Posts

let express = require('express');
let bodyParser = require('body-parser');

let server = express();
let jsonParser = bodyParser.json({ type: function() {return true;} });

server.set('port', process.env.PORT || 3000);

// either receive input as a complete body (JSON, with a 'source' tag), or
// read the source from the query string.
server.post('/', jsonParser, (request,response)=>{
  if (request.body['source']) {
    write(request.body);
  } else if (request.query['source']) {
    write( { source: request.query['source'], payload: request.body } );
  }
  response.status(202).end();
});

server.get('/', (request,response)=>{
  if (source) { write(request.query); }
  response.status(202).end();
});

server.listen(server.get('port'), ()=>{
  console.log('Relay server started on port ' + server.get('port'));
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
          console.log('Unable to read file: ' + err); 
        } else {
          postFile(filename, data);
        }
      });
  }
});


////////////////////////////////////// Helper functions

function postFile(filename, data) {
  request.post(GATEWAY, {timeout: 2000, body: data, headers: { 'x-api-key': API_KEY }}, function(err, response) {
    if (err || response && response.statusCode!==202) {
      console.log('Failed to relay ' + filename);
      console.log('Response: ' + (response && response.statusCode));
      console.log('Error: ' + err.message);
      postFailure(filename);
    } else {
      postSuccess(filename);
    }
  });
}

function postSuccess(filename) {
  let directory = DONE + '/' + (new Date().toISOString().substring(0,10));
  mkdirp(directory, (err, made) => { moveFile(WIP, filename, directory) });
}

function postFailure(filename) {
  moveFile(WIP, filename, RETRY);
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
  console.log('retry');
  moveFiles(RETRY, WIP);
}