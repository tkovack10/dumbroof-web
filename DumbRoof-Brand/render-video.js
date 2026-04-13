// Render whoops-video.html frame by frame using Playwright
const { execSync } = require('child_process');
const path = require('path');

async function render() {
  // Find playwright
  const npmRoot = execSync('npm root -g').toString().trim();
  let pw;
  try {
    pw = require(npmRoot + '/playwright');
  } catch(e) {
    // Try npx approach - use the CLI to just get module path
    pw = require(require('child_process').execSync('node -e "console.log(require.resolve(\'playwright\', {paths: [process.cwd(), require(\'child_process\').execSync(\'npm root -g\').toString().trim()]}))"').toString().trim().replace('/index.js', ''));
  }

  const FPS = 30;
  const VIDEO_END = 12; // seconds total
  const totalFrames = Math.ceil(VIDEO_END * FPS);
  const framesDir = path.join(__dirname, 'frames');

  // Create frames dir
  execSync(`mkdir -p ${framesDir}`);
  execSync(`rm -f ${framesDir}/*.png`);

  console.log(`Rendering ${totalFrames} frames at ${FPS}fps...`);

  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.goto('file://' + path.join(__dirname, 'whoops-video.html'));
  await page.waitForTimeout(2000); // let fonts load

  // Stop the auto-play animation
  await page.evaluate(() => { window.startTime = Infinity; });

  for (let i = 0; i < totalFrames; i++) {
    const t = i / FPS;
    await page.evaluate((time) => window.renderFrame(time), t);

    const frameNum = String(i).padStart(5, '0');
    await page.screenshot({ path: path.join(framesDir, `frame_${frameNum}.png`) });

    if (i % 30 === 0) {
      console.log(`Frame ${i}/${totalFrames} (${(t).toFixed(1)}s)`);
    }
  }

  await browser.close();
  console.log('All frames rendered!');

  // Stitch with ffmpeg
  console.log('Encoding MP4...');
  const outputPath = path.join(__dirname, 'whoops-intro.mp4');
  execSync(`/tmp/ffmpeg -y -framerate ${FPS} -i ${framesDir}/frame_%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow "${outputPath}"`, { stdio: 'inherit' });

  console.log(`Done! Video saved to: ${outputPath}`);

  // Cleanup frames
  execSync(`rm -rf ${framesDir}`);
}

render().catch(e => {
  console.error('Error:', e.message);

  // Fallback: try with npx playwright approach
  console.log('Trying fallback approach...');
});
