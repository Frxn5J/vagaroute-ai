import type { ChatRequest } from '../types';
import { estimateTextTokens } from './tokenizer';
import { logger } from '../utils/logger';

export function estimateEmulationTokenOverhead(tools: any[]): number {
  if (!tools || tools.length === 0) return 0;
  // Prompt instructions: ~100 tokens
  // Tool descriptions: ~30-50 tokens per tool depending on complexity
  const toolsJson = JSON.stringify(tools);
  return 150 + estimateTextTokens(toolsJson);
}

function buildToolSystemPrompt(tools: any[]): string {
  const toolDescriptions = tools
    .map(tool => {
      if (tool.type !== 'function') return '';
      const fn = tool.function;
      return `### ${fn.name}
Description: ${fn.description || 'No description provided'}
Parameters: ${JSON.stringify(fn.parameters || {})}`;
    })
    .join('\n\n');

  return `You are a helpful AI assistant with access to tools. 
To call a tool, you MUST respond using this EXACT XML format and nothing else around it:

<tool_call>
{"name": "function_name", "arguments": {"param_name": "param_value"}}
</tool_call>

You can make multiple tool calls by using multiple <tool_call> blocks.
If you don't need to use any tools, just respond with normal text WITHOUT any <tool_call> tags.

Available tools:

${toolDescriptions}
`;
}

export function transformRequestForEmulation(request: ChatRequest): ChatRequest {
  if (!request.tools || request.tools.length === 0) return request;

  const systemPrompt = buildToolSystemPrompt(request.tools);
  const messages = [...request.messages];

  // Inject system prompt
  const existingSystemIndex = messages.findIndex(m => m.role === 'system');
  if (existingSystemIndex >= 0) {
    const existingContent = typeof messages[existingSystemIndex].content === 'string' 
      ? messages[existingSystemIndex].content 
      : JSON.stringify(messages[existingSystemIndex].content);
    messages[existingSystemIndex] = {
      ...messages[existingSystemIndex],
      content: `${existingContent}\n\n${systemPrompt}`
    };
  } else {
    messages.unshift({ role: 'system', content: systemPrompt });
  }

  // Transform tool and assistant messages
  const transformedMessages = messages.map(msg => {
    if (msg.role === 'tool') {
      return {
        role: 'user' as const,
        content: `Tool '${msg.name || msg.tool_call_id}' returned:\n${msg.content}`
      };
    }
    if (msg.role === 'assistant' && msg.tool_calls) {
      const callsText = msg.tool_calls.map(tc => 
        `<tool_call>\n${JSON.stringify({ name: tc.function.name, arguments: JSON.parse(tc.function.arguments || '{}') })}\n</tool_call>`
      ).join('\n');
      
      const textContent = typeof msg.content === 'string' ? msg.content : '';
      return {
        role: 'assistant' as const,
        content: textContent ? `${textContent}\n${callsText}` : callsText
      };
    }
    return msg;
  });

  const { tools, tool_choice, ...rest } = request;
  return {
    ...rest,
    messages: transformedMessages
  };
}

export function parseToolCallsFromText(text: string, tools: any[]): { content: string, toolCalls: any[] } {
  const toolCalls: any[] = [];
  let cleanContent = text;
  
  const validToolNames = new Set(tools.map(t => t.function?.name).filter(Boolean));

  // Extract <tool_call> blocks
  const toolCallRegex = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g;
  let match;
  let toolIndex = 0;

  while ((match = toolCallRegex.exec(text)) !== null) {
    try {
      const callData = JSON.parse(match[1]);
      if (callData.name && validToolNames.has(callData.name)) {
        toolCalls.push({
          index: toolIndex++,
          id: `call_${Math.random().toString(36).slice(2, 10)}`,
          type: 'function',
          function: {
            name: callData.name,
            arguments: typeof callData.arguments === 'string' ? callData.arguments : JSON.stringify(callData.arguments || {})
          }
        });
        
        // Remove this block from the clean content
        cleanContent = cleanContent.replace(match[0], '').trim();
      }
    } catch (err) {
      logger.warn({ err, match: match[1] }, 'Failed to parse emulated tool call JSON');
    }
  }

  return { content: cleanContent, toolCalls };
}

export async function* wrapStreamWithToolParsing(
  stream: AsyncIterable<string>, 
  tools: any[], 
  id: string, 
  model: string
): AsyncGenerator<string> {
  let fullText = '';
  let usage: any = null;
  
  // Consume entire stream
  for await (const chunk of stream) {
    const line = chunk.trim();
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    
    try {
      const data = JSON.parse(line.slice(6));
      if (data.usage) usage = data.usage;
      const content = data.choices?.[0]?.delta?.content;
      if (content) fullText += content;
    } catch {
      // ignore parse errors mid-stream
    }
  }

  // Parse tools
  const { content, toolCalls } = parseToolCallsFromText(fullText, tools);
  
  // Re-emit
  if (content) {
    yield `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { content }, finish_reason: null }]
    })}\n\n`;
  }

  if (toolCalls.length > 0) {
    yield `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }]
    })}\n\n`;
  }

  const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
  yield `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    ...(usage ? { usage } : {})
  })}\n\n`;
  
  yield 'data: [DONE]\n\n';
}
