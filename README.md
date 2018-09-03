# Relay

Listens on HTTP, and to UDP, and relays what is received to an AWS Gateway. From the Gateway, it is pushed into S3 and IoT using lambda functions.

Intention is to run it on a Raspberry Pi.

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


## Environment

```
export AWS_API_KEY=
export DEVICE_NAME=       # default: RELAY_DEV
export MESSAGE_DIRECTORY= # default: /var/iot_relay
```