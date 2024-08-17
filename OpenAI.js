import OpenAI from 'openai';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
dotenv.config();
const client = new OpenAI({ baseURL: 'https://api.openai.com/v1', apiKey: process.env.O_API_KEY });
const MODEL = 'gpt-4o-mini';

const tools = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the internet to find up-to-date information on a given topic.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The query to search for."
          }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_webpage",
      description: "Returns a string with all the content of a webpage. Some websites block this, so try a few different websites.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL of the site to search."
          }
        },
        required: ["url"],
        additionalProperties: false
      }
    }
  }
];

async function webSearch(args, id) {
  const query = args.query;
  try {
    const result = await performSearch(query);
    const function_call_result_message = {
      role: "tool",
      content: result,
      tool_call_id: id
    };
    return function_call_result_message;
  } catch (error) {
    const errorMessage = `Error while performing web search: ${error}`;
    console.error(errorMessage);
    const function_call_result_message = {
      role: "tool",
      content: JSON.stringify({
        error: errorMessage
      }),
      tool_call_id: id
    };
    return function_call_result_message;
  }
}

async function searchWebpage(args, id) {
  const url = args.url;
  try {
    const result = await searchWebpageContent(url);
    const function_call_result_message = {
      role: "tool",
      content: result,
      tool_call_id: id
    };
    return function_call_result_message;
  } catch (error) {
    const errorMessage = `Error while searching the site: ${error}`;
    console.error(errorMessage);
    const function_call_result_message = {
      role: "tool",
      content: JSON.stringify({
        error: errorMessage
      }),
      tool_call_id: id
    };
    return function_call_result_message;
  }
}

async function searchWebpageContent(url) {
  const TIMEOUT = 5000; // 5 seconds
  const MIN_CONTENT_LENGTH = 500; // Minimum length for valid content

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out after 5 seconds')), TIMEOUT)
  );

  try {
    const response = await Promise.race([fetch(url), timeoutPromise]);

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    $('script, style').remove();
    let bodyText = $('body').text();

    bodyText = bodyText.replace(/<[^>]*>?/gm, ''); // remove HTML tags
    bodyText = bodyText.replace(/\s{6,}/g, '  '); // replace sequences of 6 or more whitespace characters with 2 spaces
    bodyText = bodyText.replace(/(\r?\n){6,}/g, '\n\n'); // replace sequences of 6 or more line breaks with 2 line breaks

    const trimmedBodyText = bodyText.trim();
    /*
    if (trimmedBodyText.length < MIN_CONTENT_LENGTH) {
      throw new Error('Content is too short; less than 500 characters');
    }
    */

    return trimmedBodyText;
  } catch (error) {
    throw new Error(error.message || 'Could not search content from webpage');
  }
}

async function performSearch(query) {
  const url = `https://search.neuranet-ai.com/search?query=${encodeURIComponent(query)}&limit=5`;

  const response = await axios.get(url)
    .catch(error => {
      throw new Error(`Failed to perform the search request: ${error.message}`);
    });

  const entries = response.data;

  const resultObject = entries.slice(0, 5).map((entry, index) => {
    const title = entry.title;
    const result = entry.snippet;
    const url = entry.link;

    return { [`result_${index + 1}`]: { title, result, url } };
  });

  const note = {
    "Note": "These are only the search results overview. Please use the Scrape Webpage tool to search further into the links."
  };

  return JSON.stringify(resultObject.reduce((acc, curr) => Object.assign(acc, curr), note), null, 2);
}

/*
async function performSearch(query) {
  const url = 'https://websearch.plugsugar.com/api/plugins/websearch';
  const response = await axios.post(url, { query: query })
    .catch(error => {
      throw new Error(`Failed to perform the initial search request: ${error.message}`);
    });
  const rawText = response.data.result;
  const entries = rawText.trim().split('\n\n').slice(0, 5);

  const resultObject = await Promise.all(entries.map(async (entry, index) => {
    const lines = entry.split('\n');
    const title = lines.find(line => line.startsWith('Title:')).replace('Title: ', '');
    const result = lines.find(line => line.startsWith('Result:')).replace('Result: ', '');
    const url = lines.find(line => line.startsWith('URL:')).replace('URL: ', '');

    return { [`result_${index + 1}`]: { title, result, url } };
  }));
  
  const note = {
    "Note": "These are only the search results overview. Please use the Scrape Webpage tool to search further into the links."
  };

  return JSON.stringify(resultObject.reduce((acc, curr) => Object.assign(acc, curr), note), null, 2);
}

async function performSearch(query) {
  const url = 'https://websearch.plugsugar.com/api/plugins/websearch';
  const response = await axios.post(url`, { query: query })
    .catch(error => {
      throw new Error(`Failed to perform the initial search request: ${error.message}`);
    });
  const rawText = response.data.result;
  const entries = rawText.trim().split('\n\n').slice(0, 3);

  const resultObject = await Promise.all(entries.map(async (entry, index) => {
    const lines = entry.split('\n');
    const title = lines.find(line => line.startsWith('Title:')).replace('Title: ', '');
    let result = lines.find(line => line.startsWith('Result:')).replace('Result: ', '');
    const url = lines.find(line => line.startsWith('URL:')).replace('URL: ', '');

    try {
      const searchedContent = await searchWebpageContent(url);
      result = searchedContent;
    } catch (error) {
      console.error(`Failed to search content from ${url}:`, error);
    }

    return { [`result_${index + 1}`]: { title, result, url } };
  }));
  
  const note = {
    "Note": "The search results contain raw searched website content, and you need to extract relevant information from this and present it to the user in a well-structured manner."
  };

  return JSON.stringify(resultObject.reduce((acc, curr) => Object.assign(acc, curr), note), null, 2);
}
*/

const systemPrompt = "You are Search GPT, a helpful assistant with the ability to perform web searches and view websites using the tools provided. When a user asks you a question, you can use web search to find up-to-date information on that topic. You can retrieve the content of webpages from search result links using the Search Website tool. Use several tool calls consecutively, performing deep searches and trying your best to extract relevant and helpful information before responding to the user.";

let mainMessages = [
  { role: "user", content: "Hi, can you search the web for me?" },
  { role: "assistant", content: "Hi there! I can help with that. Can you tell me a bit about your query?" }
];

async function getResponse(query) {
  mainMessages.push({ role: "user", content: query });
  let fullResponce = "";
  async function sendRequest() {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...mainMessages],
      tools: tools
    });

    const toolCalls = response.choices[0].message?.tool_calls;
    if (toolCalls) {
      const toolCallsResults = [response.choices[0].message];
      for (const toolCall of toolCalls) {
        const result = await manageToolCall(toolCall);
        toolCallsResults.push(result);
      }
      mainMessages.push(...toolCallsResults);
      fullResponce = fullResponce.trim() + `\n\n- [TOOL CALLS: ${processToolCallsNames(response)}]\n\n` + (response.choices[0].message?.content || '');
      return await sendRequest();
    } else {
      fullResponce = fullResponce.trim() + '\n\n' + response.choices[0].message?.content;
      return fullResponce.trim();
    }
  }
  return await sendRequest();
}

/*
{
  finish_reason: 'tool_calls',
  index: 0,
  logprobs: null,
  message: {
    content: null,
    role: 'assistant',
    function_call: null,
    tool_calls: [
      {
        id: 'call_62136354',
        function: {
          arguments: '{"query":"Latest sports news"}',
          name: 'web_search'
        },
        type: 'function'
      }
    ]
  }
}
*/

async function manageToolCall(toolCall) {
  const tool_calls_to_function = {
    "web_search": webSearch,
    "search_webpage": searchWebpage
  }
  const functionName = toolCall.function.name;
  const func = tool_calls_to_function[functionName];
  if (func) {
    const args = JSON.parse(toolCall.function.arguments);
    const result = await func(args, toolCall.id);
    return result;
  } else {
    const errorMessage = `No function found for ${functionName}`;
    console.error(errorMessage);
    const function_call_result_message = {
      role: "tool",
      content: JSON.stringify({
        error: errorMessage
      }),
      tool_call_id: toolCall.id
    };
    return function_call_result_message;
  }
}

function processToolCallsNames(response) {
  const toolCalls = response.choices[0].message.tool_calls;
  return toolCalls
    .map(tc => {
      if (!tc || !tc.function || !tc.function.name) return '';

      const formattedName = tc.function.name.split('_')
        .map(word => {
          if (isNaN(word)) {
            return word.charAt(0).toUpperCase() + word.slice(1);
          }
          return word;
        })
        .join(' ');

      let formattedArgs = '';
      if (tc.function.arguments) {
        try {
          const argsObject = JSON.parse(tc.function.arguments);
          formattedArgs = Object.entries(argsObject)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
        } catch (e) {
          console.error('Error parsing arguments:', e);
        }
      }

      return formattedArgs ? `${formattedName} (${formattedArgs})` : formattedName;
    })
    .filter(name => name)
    .join(', ');
}

console.log(await getResponse('Some news related to sports.'));
