import { init } from '@heyputer/puter.js/src/init.cjs';

async function main() {
    const puter = init("test-token");
    try {
        console.log(Object.keys(puter.ai));
        console.log(puter.ai.chat.toString());
    } catch(e) {
        console.error(e);
    }
}
main();
