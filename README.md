
This little server acts as a relay, pushing UDP requests (and HTTP requests) to an HTTP endpoint (AWS) and or MQTT (Home Assistant).

# Relay

Listens on HTTP, and to UDP, and relays what is received to an HTTP endpoint, and or to an MQtt broker. In may case, the end point is an AWS Gateway, and MQTT is a Home Assistant system.

Of course, from the Gateway, you can leverage standard AWS mechanisms for processing the messages.

Examples of Arduino applications that feeds this relay can be seen [here](https://github.com/renenw/harduino). The key function can be seen below.

This code runs on a Raspberry Pi 3b, which also hosts a Nginx proxy to deal with inbound HTTP requests.

# Why?

I have several Arduino devices that track things like the depth of my swimming pool, as well as folk entering a PIN code to open the front gate. It is convenient for these devices to communicate events using UDP. However, AWS Gateway doesn't allow UDP endpoints and I'm not convinced embedded devices should be making HTML type requests.

# Relay Gateway End Point
A JSON object is constructed with four fields, and POST'ed to the `GATEWAY` (typically, a AWS API Gateway connected to an SNS topic). The JSON object submitted is as follows:
```
{
  "source":"my_sensor",
  "payload":"27.2",
  "received":1585834636.495,
  "uid":"1585834636.495.91480029"
}
```
|Field|Description|
|-|-|
|`source`|The device or source from which this message originates|
|`payload`|The payload. Either the message part of the UDP packet. Or, the JSON body submitted via HTTP.|
|`received`|The time, in seconds with millisecond resolution, that this packet was written to a queue by the relay server.|
|`uid`|A unique identifier.|

# MQTT End Point

Received data is pushed to an MQTT broker, with the `sensor name` used as a topic name.

To test that MQTT is working as expected, try subscribing to all topics: `mosquitto_sub -v -t '#'`.

# UDP Submissions
## Structure
`<sensor_name>[space]<payload>`

## Bash Example
```
echo -n "my_sensor_name 27.2" >/dev/udp/localhost/54545
```
## Arduino Code
```
void udp(String sensor, String message) {
  String payload = sensor + " " + message;
  char p[50];
  payload.toCharArray(p, 50);
  if (DEBUG==false) {
    Udp.beginPacket(server_ip, udp_port);
    Udp.write(p);
    Udp.endPacket();
  } else {
    Serial.println(p);
  }
}
```

# HTTP Submissions
Either a GET, in which case the payload is derived from the query string. Or, a POST, in which case the payload is expected in the HTTP body.

## GET
GET "submissions" are accepted through the query string. `source` is a required parameter.
```
curl --location --request GET 'localhost:3553?source=piano_pi&action=rotate_to_90&image=23jkbshdfvuh23r8y'
```
## POST
POST submissions should either have a JSON body that includes a `source` field. Or must have the `source` supplied as a query string parameter.
```
curl --location --request POST 'localhost:3553' \
--header 'Content-Type: application/json' \
--header 'Content-Type: text/plain' \
--data-raw '{
  "source": "piano-pi",
  "payload": {
    "bar": 2,
    "foo": 1
  }
}'
```
# Keep Alive
Every minute, the relay server uploads a packet reflecting success and failure counts since the last submission:
```
{
  "source":"ubuntu1910",
  "payload":{"successes":0,"failures":0},
  "received":1585838990.455,
  "uid":"1585838990.455.50740082"
}
```
# Queue Processing

Relies on directories as a queuing mechanism.

1. Submissions (HTTP or UDP) are initially written out as JSON files in the IN directory.
2. Node reacts to these new files, copying them into a WIP directory.
3. From the WIP directory, they are pushed first to MQTT (if configured), and then, via HTTP, to an AWS Gateway.
4. Failures are moved to a RETRY directory, and periodically reattempted.
5. You probably want to delete files that have been successfully processed. I use a cron (see below)/

Note, your gateway API should be idempotent. File names uniquely identify submissions.


# Setup
## Base Installation
I used these instructions to install node and npm: https://thisdavej.com/beginners-guide-to-installing-node-js-on-a-raspberry-pi/

```
sudo mkdir /var/iot_relay
sudo chmod 777 /var/iot_relay/

cd ~
git clone https://github.com/renenw/relay.git
cd relay
npm install mkdirp --save
npm install express --save
npm install axios --save
npm install mqtt --save
```
Test: `node server`
```
pi@iot-relay:~/relay $ node server
Starting: iot-relay
HTTP on 3553
UDP on 54545
Working directory: /var/iot_relay
API endpoint: https://<my gateway>/ingest
UDP listener listening on 0.0.0.0:54545
HTTP listener started on port 3553
```

## Setup Environment Variables
On a Raspberry Pi: `sudo nano /etc/profile` and add your environment variables at the end:
```
export GATEWAY=https://<your gateway>/ingest
export API_KEY=<your key>
export MQTT_BROKER=<localhost, or your MQTT broker IP>
```

**NB:** To make pm2 refresh its understanding of these environment variables, you must run: `pm2 stop server` then `pm2 start server --update-env`.

For details on how these variables are used, see Environment Variables below. In particular,  the API_KEY is passed to the Gateway POST request as an `x-api-key` header.


I restart the device, and test that our changes worked by calling: `printenv GATEWAY`

## Service creation
I took [this article's](https://www.digitalocean.com/community/tutorials/how-to-set-up-a-node-js-application-for-production-on-ubuntu-18-04) guidance.
```
sudo npm install pm2@latest -g
pm2 start server.js
pm2 startup systemd
```
And, run the command as instructed by the previous step.

Finally, and I'm not entirely sure why: `pm2 save`

### Useful PM2 commands

```
pm2 list
pm2 stop server
pm2 start server
pm2 start server --update-env   # not sure this worked
pm2 restart server
pm2 info server
pm2 logs server
pm2 monit
pm2 restart all --update-env    # this may have worked - but also ran an update of pm2
```

## Clean Up Cron
I use a nightly cron:

`find /var/iot_relay/done/* -maxdepth 1 -type d -ctime +7  | xargs rm -rf`
# Environment Variables

|Variable|Default|Purpose|
|-|-|-|
|DEVICE_NAME|*System host name*|Used as the `source` in the submission of metrics.|
|GATEWAY|https://relay.free.beeceptor.com|Endpoint messages will be forwarded to.|
|UDP_PORT|`54545`|UDP port on which server will listen.|
|HTTP_PORT|`3553`|TCP port on which HTTP server will listen.|
|GATEWAY|*None*|AWS Gateway URL where payloads will be posted.|
|MESSAGE_DIRECTORY|`/var/iot_relay`|Directory where messages are stored. Several sub-directories will be created beneath this root to manage message flow to AWS.|
|API_KEY|*None*|I leverage AWS Gateway's API key mechanism to secure requests. This `API_KEY` is used to set the `x-api-key` header on submissions.|
|MQTT_BROKER|*None*|IP address of MQTT broker. If your broker is running on the same Pi, `localhost`. If this variable is not set, MQTT messages will not be sent.|
### Gotcha
To make pm2 refresh its understanding of these environment variables, you must run: `pm2 start server --update-env`

### Samples
Typically you will just set the 
```
export DEVICE_NAME=my_arduino
export GATEWAY=https://relay.free.beeceptor.com
export HTTP_PORT=3000
export UDP_PORT=3000
export MESSAGE_DIRECTORY=/blah
export API_KEY=abcd
export MQTT_BROKER=localhost
```
# Amazon Setup
API Gateway --> SNS --> lamda: [see](https://www.alexdebrie.com/posts/aws-api-gateway-service-proxy/)
