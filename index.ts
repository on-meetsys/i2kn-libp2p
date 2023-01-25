import type { Libp2pOptions } from 'libp2p';

async function start(
  privKey: string,
  bootstraps: string[],
  swarmKey: string,
  mainpubsub: string,
): Promise<boolean> {
  const { createLibp2p } = await import('libp2p');
  // const { webRTCStar } = await import('@libp2p/webrtc-star');
  const { bootstrap } = await import('@libp2p/bootstrap');
  const { tcp } = await import('@libp2p/tcp');
  const { mdns } = await import('@libp2p/mdns');
  const { mplex } = await import('@libp2p/mplex');
  const { noise } = await import('@chainsafe/libp2p-noise');
  const { unmarshalPrivateKey } = await import('@libp2p/crypto/keys');
  const { createFromPrivKey } = await import('@libp2p/peer-id-factory');
  const { preSharedKey } = await import('libp2p/pnet');
  const { gossipsub } = await import('@chainsafe/libp2p-gossipsub');
  const { logger } = await import('@libp2p/logger');
  const uint8ArrayFromString = (await import('uint8arrays/from-string')).fromString;

  const log = logger('i2kn:api:libp2p');
  log('libp2p starting');

  // create PeerId from privateKey (required to sign messages)
  const privKeyBuffer = uint8ArrayFromString(privKey, 'base64pad');
  const PK = await unmarshalPrivateKey(privKeyBuffer);
  const myPeerId = await createFromPrivKey(PK);

  const connectionProtector = preSharedKey({
    psk: new Uint8Array(Buffer.from(swarmKey, 'base64')),
  });

  const p2pOptions: Libp2pOptions = {
    peerId: myPeerId,
    addresses: {
      listen: [
        '/ip4/0.0.0.0/tcp/64000',
      ],
    },
    transports: [
      tcp(),
    ],
    peerDiscovery: [
      mdns(),
    ],
    streamMuxers: [mplex()],
    connectionEncryption: [noise()],
    pubsub: gossipsub({
      allowPublishToZeroPeers: true, // or error thrown, not catchable...
      doPX: true, // for bootstraps
      // directPeers:
    }),
    // nat: {
    // bug freebox : https://dev.freebox.fr/bugs/task/20501
    //   description: 'i2KnV3',
    //   enabled: true, // defaults to true
    //   // gateway: '192.168.1.1', // leave unset to auto-discover
    //   // externalIp: '80.1.1.1', // leave unset to auto-discover
    //   // localAddress: '129.168.1.123', // leave unset to auto-discover
    //   ttl: 7200, // TTL for port mappings (min 20 minutes)
    //   keepAlive: true, // Refresh port mapping after TTL expires
    // },
    connectionProtector,
  };

  // Add boostraps nodes if any
  bootstraps = bootstraps.filter((b) => b.length > 0);
  if (bootstraps && bootstraps.length) {
    p2pOptions.peerDiscovery?.push(bootstrap({
      list: bootstraps,
    }));
    log('add boostraps %o', bootstraps);
  }

  // if (isMasternode) {
  //   // https://github.com/libp2p/js-libp2p/tree/master/examples/auto-relay
  //   // p2pOptions.relay = {
  //   //   enabled: true,
  //   //   hop: {
  //   //     enabled: true,
  //   //     active: true,
  //   //   },
  //   //   advertise: {
  //   //     bootDelay: 15 * 60 * 1000,
  //   //     enabled: true,
  //   //     ttl: 30 * 60 * 1000,
  //   //   },
  //   // };
  //   p2pOptions.addresses.listen.push('/ip4/0.0.0.0/tcp/15555/ws/p2p-webrtc-star');
  // }

  const libp2pnode = await createLibp2p(p2pOptions);

  libp2pnode.addEventListener('peer:discovery', (evt) => {
    const { detail: peer } = evt;
    log('libp2p.onPeerDiscovery', peer.id.toString());

    // peer.multiaddrs.forEach((multiaddr) => libp2pnode.dial(multiaddr));
    try {
      libp2pnode.dial(peer.id);
    } catch (error) {
      log('libp2p.onPeerDiscovery error', error);
    }
  });

  libp2pnode.addEventListener('peer:connect', async (evt) => {
    const { detail: connection } = evt;
    const { remotePeer } = connection;
    const remotePeerId = remotePeer.toString();
    log('libp2p.onPeerConnected', remotePeerId);
  });

  libp2pnode.addEventListener('peer:disconnect', (evt) => {
    const { detail: connection } = evt;
    const { remotePeer } = connection;
    const remotePeerId = remotePeer.toString();
    log('libp2p.onPeerDisconnected', remotePeerId);
  });

  // TODO test this
  // libp2pnode.getProtocols();
  // libp2pnode.getConnections();
  // await libp2pnode.dial(peerId); // = connect

  await libp2pnode.start();

  if (libp2pnode.isStarted() === false) return false;
  log('libp2p started');

  // subscribe to ALL pubsub events
  // libp2pnode.pubsub.addEventListener('message', (evt) => {
  //   win.webContents.send(evt.detail.topic, evt.detail.data);
  // });

  // subscribe to ALL pubsub events
  // (libp2pnode.pubsub as PubSub<GossipsubEvents>).addEventListener('gossipsub:message', async (evt) => {
  //   const uint8ArrayToString = (await import('uint8arrays/to-string')).toString;
  //   const msg = evt.detail.msg as SignedMessage;
  //   win.webContents.send(
  //     msg.topic,
  //     msg.from.toString(),
  //     uint8ArrayToString(msg.data),
  //   );
  // });

  // (libp2pnode.pubsub as PubSub<GossipsubEvents>)
  // .addEventListener('gossipsub:heartbeat', (evt) => {
  //   log('gossipsub:heartbeat %o', evt);
  // });

  // disconnected 'hack'...
  setInterval(() => {
    const peers = libp2pnode.pubsub.getSubscribers(mainpubsub);
    log('pubsub peers', mainpubsub, peers);
    libp2pnode.pubsub.publish(mainpubsub, new TextEncoder().encode(JSON.stringify({
      command: 'heartbeat',
      message: myPeerId.toString(),
    })));
  }, 10000);

  const multiAddrs = libp2pnode.getMultiaddrs();
  console.log(multiAddrs.map((m) => m.toString()));

  return true;
}

start(
  'CAASpwkwggSjAgEAAoIBAQCZ8y9zRJUZCDzusYsXUoNL27BD6//9uWTzX1GljEjFShrwf6sgV76YwGT/kc4svdySzae+l/TxotI2/r1pk1vhOfg5gYqxQ3mmezu/Vu+tC0Djh6FaW/PJ5RuV/C2C407uTsd76osERV2bCzkIDSwjaOiq6cKctv+Se8CvQstouaMSDuYZPM1kJbrBqVix3gr+yCeAPOlVw82l9PEeri7xpeI9R7IMJq43NRnZAzsFhKbYvPhyRSIkQjcgrPic65NNplDb8fm/TlTjsPy5gbKqEH4J8T32BT+Z6AJi4w2ei0YoW6x5fKVvAMarNSBhxR0DCJAii3IPsVSjL7VWAibJAgMBAAECggEADNECEkaTYxIcgIKnYbms1JPliMIM/cKBdQFqeq3DISmaNItsY7TqWS0rO1uYHoFv64jTfjqIWdWESq/KdQ+fhpCc6ayvLzK+3e1EfBlwuqdFL6wK8srU8Onx8fqcj1j9KTnFwbs095YOxOmaReFS21/QfuoXGZTikf9bezvEU2N/5FRPLP7CAksaNsOk7pL5ma9HQs1KmsiEZGmBeubyqJSXHPGub6iBlNhRRA7g3WJBuqf0+xrI9StPQbP1yBsdWe8QtFDtkRc/eoMWsrLeGpGTBjonfRQkt4Nuj/8vuUlKH+9uSF1vvOO/UypW8GkFKA59tZu7D2Fwh6vnzaRhAQKBgQDSGNo6MtzO03EpgVOFx4aQ1QyND6HD22WRBWOOwNHSRks7LiGzLT5awAhS62/voyqbNlu5Dz4ul/IXU+uqbJmiA5rA9HA7R/+8iA9Lhm2MXM2PgMDXgJ4aFzBdMrOwPwFV/gbmsajHb0HnxgOKuwbrxGaGW1zsDZQ0r0BOxsKoJQKBgQC7lelvB4ESySVXW3ZOrqmsnm47v/hb5xPz8z9HIihM7RQZGT78jkDauMZkAFZBDJ8njmgFb8z0TQ0Z7yNM3zLoCybXELh1jNo0bYdcGFquTgb8bwu4sysA7bCahF9svbVSFByNHBxO4A0f4nzvPCQH52B0MJeYQVbvenvP9wdA1QKBgQCGR8oazm1gZ7X5ACaA56CzKugltGsAwlYtFVOnZsf0bGcjAP4bBfzHhdsMHFxjvla580k2g26L2yOpE0MZnuWmrkUXtGOTEBZ8yj10WQvlXV8oq/MVCaiDJnUL7B76s5pH+t8wTTaBmTN3TpDu91CaGeIpV3WRjbA+6A/jCZhaXQKBgDxghiAMhEjtoS067RtqMIa0/7oPkfrSp6NvecCFh/8ql7t0WsejadB8hK6PRTPuwhNTTLvjPk6rtjnQtMX7WUFCxZ+XbCe5zEnvrw+/bwCHcMwzWcx7Lq4/0wYI8UXo0cG3Y3EvyRTCHLdUiO3fp6E7odoEAecpsLen7s4DLrx5AoGAJK1s5UnpGBeSlGJBkxsBuHPEYVP9gaMzrgcw0+vZKJJLFeAtJ+QsRQnztFE+y1SuzkwOcpeOlvSYEYV286BpkdhMi1V6Vd7paj7bUXltLEUlhJ8wGddnLz58OhBhsm812JIpX8BVx7EfvDzUGwrrRBLQ3bPNe/vqr2MjOrgQyYM=',
  [],
  'L2tleS9zd2FybS9wc2svMS4wLjAvCi9iYXNlMTYvCjA1OTQ1NGQxNzAwNmIzM2NmYmVlNDgwM2QxOTk3YTYxODc4N2I4MzQ3YjVhOGVjM2YzMzVkNWE2NWU4MTU2YmI=',
  'I2KNV3',
);