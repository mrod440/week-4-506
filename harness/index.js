const http = require('http');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function runHarness() {
  console.log("======================================");
  console.log("       RACE CONDITION HARNESS         ");
  console.log("======================================\n");
  
  await request('POST', '/reset');
  
  console.log("1. Simulating saving the initial draft: 'Draft 1'");
  await request('POST', '/draft', { content: 'Draft 1' });
  console.log("   Initial draft saved.\n");
  
  console.log("2. Simulating user typing 'Draft 2' and clicking Save...");
  const draft2Promise = request('POST', '/draft', { content: 'Draft 2' });
  
  // Wait 50ms - long enough for the request to reach the server, but much faster than the 200ms save delay.
  await delay(50);
  
  console.log("3. User immediately clicks Publish before Draft 2 save completes...");
  const pubPromise = request('POST', '/publish');
  
  // Await the responses
  await draft2Promise;
  await pubPromise;
  
  console.log("\n4. Let's see what was published:");
  const finalState = await request('GET', '/published');
  console.log(`   Final published state: "${finalState.published}"\n`);
  
  if (finalState.published === 'Draft 1') {
    console.log(">>> BUG DEMONSTRATED: 'Draft 1' was published instead of 'Draft 2'!");
  } else {
    console.log(">>> Behavior unexpected or fixed.");
  }
}

runHarness().catch(console.error);
