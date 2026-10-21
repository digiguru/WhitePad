import { build } from '../../src/WhitePad.Web/node_modules/esbuild/lib/main.js';
await build({entryPoints:['src/WhitePad.Web/src/p2p/protocol.ts'],bundle:true,format:'iife',globalName:'WhitePadProtocol',target:'es2020',outfile:'src/WhitePad.iPad/WhitePad.iPad/Resources/whitepad-protocol.js',legalComments:'inline'});
