import { init } from '@heyputer/puter.js/src/init.cjs';

async function main() {
    console.log("Starting...");
    const puter = init("test-token");
    try {
        const stream = await puter.ai.chat("Hello", { stream: true, model: "claude-3-5-sonnet" });
        console.log("Got stream...");
        for await (const chunk of stream) {
            console.log(chunk);
        }
    } catch(e) {
        console.error("ERROR CAUGHT:");
        console.error(e);
        console.error("Message:", e.message);
    }
}
main();
