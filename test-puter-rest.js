const apiKey = "test-token";
async function main() {
    try {
        const res = await fetch("https://api.puter.com/puterai/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "claude-3-5-sonnet",
                messages: [{ role: "user", content: "hello" }],
                stream: false
            })
        });
        console.log(res.status, await res.text());
    } catch(e) {
        console.error(e);
    }
}
main();
