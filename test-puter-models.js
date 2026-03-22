import { init } from '@heyputer/puter.js/src/init.cjs';

async function main() {
    const puter = init("test-token");
    try {
        const models = await puter.ai.listModels();
        console.log(JSON.stringify(models.map(m => m.id), null, 2));
    } catch(e) {
        console.error("ERROR:");
        console.log(e);
    }
}
main();
