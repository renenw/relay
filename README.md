
# Relay

Listens on HTTP, and to UDP, and relays what is received to an AWS Gateway. From the Gateway, you can leverage standard AWS mechanisms for processing the messages.

The Arduino code that feeds this relay can be seen [here](https://github.com/renenw/harduino).

This code runs on a Raspberry Pi 3b, which also hosts a Nginx proxy to deal with inbound requests.

# Why?

I have several Arduino devices that track things like the depth of my swimming pool, as well as folk entering a PIN code to open the front gate. It is convenient for these devices to communicate events using UDP. However, AWS Gateway doesn't allow UDP endpoints and I'm not convinced embedded devices should be making HTML type requests.

This little server acts as a relay, pushing UDP requests (and HTML requets) to AWS.
# End Point
A JSON object is constructed with four fields:
|Field|Description|
|-|-|
|`source`|The device or source from which this message originates|
|`payload`|The payload. Either the message part of the UDP packet. Or, the JSON body submitted via HTTP.|
|`received`|The time, in seconds with millisecond resolution, that this packet was written to a queue by the relay server.|
|`uid`|A unique identifier.|
```
{
  "source":"my_sensor",
  "payload":"27.2",
  "received":1585834636.495,
  "uid":"1585834636.495.91480029"
}
```

# UDP Submissions
## Structure
`<sensor_name>[space]<payload>`

## Example
```
echo -n "my_sensor_name 27.2" >/dev/udp/localhost/54545
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
# Architecture

Relies on directories as a queing mechanism.

1. Submissions (HTTP or UDP) are initially written out as JSON files in the IN directory.
1. Node reacts to these new files, copying them into a WIP directory.
1. From the WIP directory, they are pushed, via HTTP, to an AWS Gateway.
1. Failures are moved to a RETRY directory, and periodically reattempted.

Note, your gateway API should be idempontent. File names uniquely identify submissions.

# Config

sudo mkdir /var/iot_relay
sudo chmod 777 /var/iot_relay/

npm install mkdirp --save
npm install request --save
npm install express --save


## Environment

|Variable|Default|Purpose|
|-|-|-|
|DEVICE_NAME|*System host name*|Used as the `source` in the submission of metrics|
|UDP_PORT|`54545`|UDP port on which server will listen|
|HTTP_PORT|`3553`|TCP port on which HTTP server will listen|
|GATEWAY|*None*|AWS Gateway URL where payloads will be posted|
|MESSAGE_DIRECTORY|`/var/iot_relay`|Directory where messages are stored. Several subdirectories will be created beneath this root to manage message flow to AWS|
|AWS_API_KEY|*None*|AWS API key|

### Samples
```
export DEVICE_NAME=
export HTTP_PORT=3000
export UDP_PORT=3000
export MESSAGE_DIRECTORY=
export AWS_API_KEY=
```