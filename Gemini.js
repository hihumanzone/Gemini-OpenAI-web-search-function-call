console.log(await getResponse('Some news related to sports.'));import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
dotenv.config();
const genAI = new GoogleGenerativeAI(process.env.G_API_KEY);

const function_declarations = [
  {
    name: "web_search",
    parameters: {
      type: "object",
      description: "Search the internet to find up-to-date information on a given topic.",
      properties: {
        query: {
          type: "string",
          description: "The query to search for."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "search_webpage",
    parameters: {
      type: "object",
      description: "Returns a string with all the content of a webpage. Some websites block this, so try a few different websites.",
      properties: {
        url: {
          type: "string",
          description: "The URL of the site to search."
        }
      },
      required: ["url"]
    }
  }
];

const systemPrompt = "You are Gemini Search, a helpful assistant with the ability to perform web searches and view websites using the tools provided. When a user asks you a question, you can use web search to find up-to-date information on that topic. You can retrieve the content of webpages from search result links using the Search Website tool. Use several tool calls consecutively, performing deep searches and trying your best to extract relevant and helpful information before responding to the user.";

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  tools: { functionDeclarations: function_declarations },
  systemInstruction: systemPrompt
});

const tool_config = {
  function_calling_config: {
    mode: "ANY"
  }
};

async function webSearch(args, name) {
  const query = args.query;
  try {
    const result = await performSearch(query);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            name: name,
            content: result
          }
        }
      }
    ];
    return function_call_result_message;
  } catch (error) {
    const errorMessage = `Error while performing web search: ${error}`;
    console.error(errorMessage);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            name: name,
            content: errorMessage
          }
        }
      }
    ];
    return function_call_result_message;
  }
}

async function searchWebpage(args, name) {
  const url = args.url;
  try {
    const result = await searchWebpageContent(url);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            name: name,
            content: result
          }
        }
      }
    ];
    return function_call_result_message;
  } catch (error) {
    const errorMessage = `Error while searching the site: ${error}`;
    console.error(errorMessage);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            name: name,
            content: errorMessage
          }
        }
      }
    ];
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

    return {
      [`result_${index + 1}`]: { title, result, url }
    };
  });

  const note = {
    "Note": "These are only the search results overview. Please use the Scrape Webpage tool to search further into the links."
  };

  return JSON.stringify(resultObject.reduce((acc, curr) => Object.assign(acc, curr), note), null, 2);
}

/*
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

let mainMessages = [
  { role: "user", parts: [{ text: "Hi, can you search the web for me?" }] },
  { role: "model", parts: [{ text: "Hi there! I can help with that. Can you tell me a bit about your query?" }] }
];

async function getResponse(query) {
  const chat = model.startChat({ history: mainMessages });
  let fullResponce = "";
  async function sendRequest(query) {
    const response = await chat.sendMessage(query);
    const toolCalls = response.response.functionCalls();
    if (toolCalls) {
      const toolCallsResults = [];
      for (const toolCall of toolCalls) {
        const result = await manageToolCall(toolCall);
        toolCallsResults.push(result);
      }
      fullResponce = fullResponce + `- [TOOL CALLS: ${processFunctionCallsNames(response)}]\n\n`;
      return await sendRequest(toolCallsResults);
    } else {
      fullResponce = fullResponce + '\n\n' + response.response.text();
      return fullResponce.trim();
    }
  }
  return await sendRequest(query);
}

async function manageToolCall(toolCall) {
  const tool_calls_to_function = {
    "web_search": webSearch,
    "search_webpage": searchWebpage
  }
  const functionName = toolCall.name;
  const func = tool_calls_to_function[functionName];
  if (func) {
    const args = toolCall.args;
    const result = await func(args, functionName);
    return result;
  } else {
    const errorMessage = `No function found for ${functionName}`;
    console.error(errorMessage);
    const function_call_result_message = [
      {
        functionResponse: {
          name: functionName,
          response: {
            name: functionName,
            content: errorMessage
          }
        }
      }
    ];
    return function_call_result_message;
  }
}

function processFunctionCallsNames(response) {
  const functionCalls = response.response.functionCalls();
  return functionCalls
    .map(tc => {
      if (!tc.name) return '';

      const formattedName = tc.name.split('_')
        .map(word => {
          if (isNaN(word)) {
            return word.charAt(0).toUpperCase() + word.slice(1);
          }
          return word;
        })
        .join(' ');

      const formattedArgs = tc.args ? Object.entries(tc.args)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ') : '';

      return formattedArgs ? `${formattedName} (${formattedArgs})` : formattedName;
    })
    .filter(name => name)
    .join(', ');
}

console.log(await getResponse('Some news related to sports.'));
