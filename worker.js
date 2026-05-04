// ============================================================
// 🌐 CORS Headers — Required for browser requests
// ============================================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Content-Length",
  "Access-Control-Max-Age": "86400",
};

// ============================================================
// 🎬 Main Worker Handler
// ============================================================
export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route requests to appropriate handlers
      if (path === "/create-bunny-video" && request.method === "POST") {
        return await handleCreateBunnyVideo(request, env);
      } else if (path === "/upload-bunny-chunk" && request.method === "PUT") {
        return await handleUploadBunnyChunk(request, env);
      } else if (path === "/transcribe" && request.method === "POST") {
        return await handleTranscribe(request, env);
      } else if (path === "/transcribe-status" && request.method === "GET") {
        return await handleTranscribeStatus(request, env);
      } else if (path === "/generate-gaps" && request.method === "POST") {
        return await handleGenerateGaps(request, env);
      } else {
        return errorResponse("Endpoint not found", 404);
      }
    } catch (err) {
      console.error("Worker error:", err);
      return errorResponse(err.message, 500);
    }
  },
};

// ============================================================
// 📝 Create Bunny Video
// ============================================================
async function handleCreateBunnyVideo(request, env) {
  try {
    const { title } = await request.json();

    const bunnyApiKey = env.BUNNY_API_KEY;
    const bunnyLibraryId = env.BUNNY_LIBRARY_ID;
    const cdnHost = env.BUNNY_CDN_HOST || "vod.bunnycdn.com";

    if (!bunnyApiKey || !bunnyLibraryId) {
      return errorResponse(
        "Missing Bunny API credentials in Worker secrets",
        500
      );
    }

    // Call Bunny API to create video
    const bunnyRes = await fetch(
      `https://api.bunny.net/library/${bunnyLibraryId}/videos`,
      {
        method: "POST",
        headers: {
          AccessKey: bunnyApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: title || "Untitled Video" }),
      }
    );

    if (!bunnyRes.ok) {
      const text = await bunnyRes.text();
      throw new Error(`Bunny API error: ${bunnyRes.status} - ${text}`);
    }

    const video = await bunnyRes.json();

    return jsonResponse(
      {
        guid: video.guid,
        libraryId: bunnyLibraryId,
        cdnHost: cdnHost,
        videoId: video.videoId,
      },
      200
    );
  } catch (err) {
    console.error("Create Bunny Video error:", err);
    return errorResponse(err.message, 500);
  }
}

// ============================================================
// 📤 Upload Bunny Chunk (PUT request with file data)
// ============================================================
async function handleUploadBunnyChunk(request, env) {
  try {
    const url = new URL(request.url);
    const guid = url.searchParams.get("guid");

    if (!guid) {
      return errorResponse("Missing guid parameter", 400);
    }

    const bunnyApiKey = env.BUNNY_API_KEY;
    const bunnyLibraryId = env.BUNNY_LIBRARY_ID;

    if (!bunnyApiKey || !bunnyLibraryId) {
      return errorResponse(
        "Missing Bunny API credentials in Worker secrets",
        500
      );
    }

    const file = await request.arrayBuffer();

    // Upload to Bunny
    const uploadRes = await fetch(
      `https://api.bunny.net/library/${bunnyLibraryId}/videos/${guid}`,
      {
        method: "PUT",
        headers: {
          AccessKey: bunnyApiKey,
          "Content-Type": "application/octet-stream",
        },
        body: file,
      }
    );

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      throw new Error(`Bunny upload error: ${uploadRes.status} - ${text}`);
    }

    return jsonResponse({ success: true, guid }, 200);
  } catch (err) {
    console.error("Upload chunk error:", err);
    return errorResponse(err.message, 500);
  }
}

// ============================================================
// 🎙️ Transcribe Audio
// ============================================================
async function handleTranscribe(request, env) {
  try {
    const { audioUrl } = await request.json();

    if (!audioUrl) {
      return errorResponse("Missing audioUrl", 400);
    }

    const assemblyKey = env.ASSEMBLY_AI_KEY;
    if (!assemblyKey) {
      return errorResponse("Missing AssemblyAI API key in Worker secrets", 500);
    }

    // Submit transcription job
    const submitRes = await fetch(
      "https://api.assemblyai.com/v2/transcript",
      {
        method: "POST",
        headers: {
          "Authorization": assemblyKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audio_url: audioUrl,
          language_code: "en",
        }),
      }
    );

    if (!submitRes.ok) {
      const text = await submitRes.text();
      throw new Error(
        `AssemblyAI submit error: ${submitRes.status} - ${text}`
      );
    }

    const job = await submitRes.json();

    // Check if immediately done
    if (job.status === "completed") {
      return jsonResponse({
        done: true,
        text: job.text,
        words: job.words || [],
      });
    }

    // Still pending
    return jsonResponse({
      pending: true,
      jobId: job.id,
    });
  } catch (err) {
    console.error("Transcribe error:", err);
    return errorResponse(err.message, 500);
  }
}

// ============================================================
// 📊 Check Transcription Status
// ============================================================
async function handleTranscribeStatus(request, env) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");

    if (!jobId) {
      return errorResponse("Missing jobId parameter", 400);
    }

    const assemblyKey = env.ASSEMBLY_AI_KEY;
    if (!assemblyKey) {
      return errorResponse("Missing AssemblyAI API key in Worker secrets", 500);
    }

    // Poll job status
    const statusRes = await fetch(
      `https://api.assemblyai.com/v2/transcript/${jobId}`,
      {
        method: "GET",
        headers: {
          "Authorization": assemblyKey,
        },
      }
    );

    if (!statusRes.ok) {
      const text = await statusRes.text();
      throw new Error(
        `AssemblyAI status error: ${statusRes.status} - ${text}`
      );
    }

    const job = await statusRes.json();

    if (job.status === "completed") {
      return jsonResponse({
        done: true,
        text: job.text,
        words: job.words || [],
      });
    }

    return jsonResponse({
      done: false,
      status: job.status,
    });
  } catch (err) {
    console.error("Transcribe status error:", err);
    return errorResponse(err.message, 500);
  }
}

// ============================================================
// ✨ Generate AI Gaps
// ============================================================
async function handleGenerateGaps(request, env) {
  try {
    const { transcript, level } = await request.json();

    if (!transcript || !level) {
      return errorResponse("Missing transcript or level", 400);
    }

    const openrouterKey = env.OPENROUTER_KEY;
    if (!OPENROUTER_KEYKey) {
      return errorResponse("Missing OPENROUTER API key in Worker secrets", 500);
    }

    const prompt = `You are an English language teacher. Given the following transcript and student level, identify important words/phrases to turn into gaps for a listening exercise.

Student Level: ${level}
Transcript: "${transcript}"

Guidelines:
- A1 (Beginner): 3-5 key vocabulary words
- A2 (Elementary): 4-7 important words
- B1 (Intermediate): 6-10 words including some phrasal verbs
- B2 (Upper Intermediate): 8-15 words including complex expressions
- C1 (Advanced): 10-20 including idioms and nuanced vocabulary

Return a JSON array of objects with this structure:
[
  {
    "section": "A descriptive section of the transcript",
    "answers": ["word1", "word2", "word3"]
  }
]

Only return the JSON array, no other text.`;

    const openrouterRes = await fetch("https://api.openrouter.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful English language teacher.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
      }),
    });

    if (!openrouterRes.ok) {
      const text = await openrouterRes.text();
      throw new Error(`OPENROUTER error: ${openrouterRes.status} - ${text}`);
    }

    const result = await openrouterRes.json();
    const content = result.choices[0].message.content;

    // Parse JSON response
    let sections;
    try {
      sections = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse OPENROUTER_KEY response:", content);
      sections = [];
    }

    return jsonResponse({ sections });
  } catch (err) {
    console.error("Generate gaps error:", err);
    return errorResponse(err.message, 500);
  }
}

// ============================================================
// 🛠️ Helper Functions
// ============================================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function errorResponse(message, status = 500) {
  return jsonResponse(
    {
      error: message,
      status,
    },
    status
  );
}
