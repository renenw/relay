# Relay

Listens on HTTP, and to UDP, and relays what is received to an AWS Gateway. From the Gateway, it is pushed into S3 and IoT using lambda functions.

Intention is to run it on a Raspberry Pi.

# Config

sudo mkdir /var/iot_relay
sudo chmod 777 /var/iot_relay/

npm install mkdirp --save
npm install request --save