const axios = require('axios');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');

// Load configuration
const config = require('./config');

// Command-line arguments
const argv = yargs(hideBin(process.argv))
  .option('action', {
    type: 'string',
    demandOption: true,
    description: 'Action to perform (sync, list, delete, download)'
  })
  .option('date', {
    type: 'string',
    description: 'Date in YYYY-MM-DD format'
  })
  .help()
  .argv;

const action = argv.action;
const date = argv.date ? `${argv.date}T00:00:00` : null;

// Ensure download directory exists
if (!fs.existsSync(config.DOWNLOAD_PATH)) {
  fs.mkdirSync(config.DOWNLOAD_PATH, { recursive: true });
}

// Get auth token
async function getAuthToken(email, password) {
  try {
    const response = await axios.post('https://birdsy.com/api/v1/auth', {
      email,
      grant_type: 'password',
      password
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    return response.data.data.attributes.token;
  } catch (error) {
    console.error('Failed to get auth token:', error.response ? error.response.data : error.message);
    throw error;  // Throw error to stop script if token can't be obtained
  }
}

// Get all video counts
async function getAllVideoCounts(token) {
  try {
    const response = await axios.get('https://birdsy.com/api/v2/episodes/days', {
      headers: {
        'authorization': token,
        'Accept': 'application/json'
      }
    });
    return response.data.meta.days;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.error('Endpoint not found for video counts.');
      return [];  // Return empty array instead of stopping script
    } else {
      console.error('Failed to get video counts:', error.response ? error.response.data : error.message);
      return [];  // Return empty array to prevent script from halting
    }
  }
}

// Get video count for a specific date
async function getVideoCountForDate(token, date) {
  try {
    const response = await axios.get('https://birdsy.com/api/v2/episodes/days', {
      headers: {
        'authorization': token,
        'Accept': 'application/json'
      }
    });
    const days = response.data.meta.days;
    const day = days.find(d => d.date === date);
    return day ? day.count : 0;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.error('Endpoint not found for video count.');
      return 0;  // Return 0 to avoid stopping the script
    } else {
      console.error('Failed to get video count for date:', error.response ? error.response.data : error.message);
      return 0;  // Return 0 to prevent script from halting
    }
  }
}

// Get all videos for a specific date
async function getAllVideosForDate(token, date) {
  const videos = [];
  let page = 1;
  const total = await getVideoCountForDate(token, date);

  while (videos.length < total) {
    try {
      const response = await axios.get(`https://birdsy.com/api/v2/episodes?page=${page}&date=${date}`, {
        headers: {
          'authorization': token,
          'Accept': 'application/json'
        }
      });
      videos.push(...response.data.data);
      page++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.error('Endpoint not found for videos.');
        break;  // Break loop but continue script
      } else {
        console.error('Failed to get videos for date:', error.response ? error.response.data : error.message);
      }
    }
  }
  return videos;
}

// Delete video by ID
async function deleteVideoById(token, id) {
  try {
    const response = await axios.post('https://birdsy.com/api/v2/episodes/group_actions/delete', {
      ids: [id]
    }, {
      headers: {
        'authorization': token,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.error('Endpoint not found for delete action.');
    } else {
      console.error('Failed to delete video:', error.response ? error.response.data : error.message);
    }
    return -1;
  }
}

// Main function
(async function main() {
  try {
    const token = await getAuthToken(config.BIRDSY_EMAIL, config.BIRDSY_PASSWORD);

    if (action === 'sync') {
      const days = await getAllVideoCounts(token);
      for (const day of days.reverse()) {
        console.log(`Syncing ${day.count} videos for ${day.date}.`);

        const videos = await getAllVideosForDate(token, day.date);
        for (const video of videos) {
          const csvPath = path.join(config.DOWNLOAD_PATH, `${video.id}.csv`);
          const thumbPath = path.join(config.DOWNLOAD_PATH, `${video.id}.jpg`);
          const videoPath = path.join(config.DOWNLOAD_PATH, `${video.id}.mp4`);

          if (fs.existsSync(csvPath)) {
            console.log(`${video.id} already downloaded. (Delete ${csvPath} to re-download.)`);
            continue;
          }

          const favorite = video.attributes.favorite ? 'true' : 'false';
          if (!video.attributes.favorite) {
            console.log(`Not downloading ${video.id} (not marked as favorite).`);
          } else {
            console.log(`Metadata:  ${csvPath}`);
            fs.writeFileSync(csvPath, `id,title,favorite,uploaded,duration,thumbnail,video\n${video.id},${video.attributes.title},${favorite},${video.attributes.formatted_recorded_at},${video.attributes.duration} s,${video.attributes.image_url},${video.attributes.video_url}\n`);

            console.log(`Thumbnail: ${thumbPath}`);
            try {
              const responseThumb = await axios({
                url: video.attributes.image_url,
                method: 'GET',
                responseType: 'stream'
              });
              const thumbStream = fs.createWriteStream(thumbPath);
              responseThumb.data.pipe(thumbStream);
              await new Promise((resolve, reject) => {
                thumbStream.on('finish', resolve);
                thumbStream.on('error', reject);
              });
            } catch (error) {
              console.error(`Failed to download thumbnail for ${video.id}:`, error.response ? error.response.data : error.message);
            }

            console.log(`Video:     ${videoPath}`);
            try {
              const responseVideo = await axios({
                url: video.attributes.video_url,
                method: 'GET',
                responseType: 'stream'
              });
              const videoStream = fs.createWriteStream(videoPath);
              responseVideo.data.pipe(videoStream);
              await new Promise((resolve, reject) => {
                videoStream.on('finish', resolve);
                videoStream.on('error', reject);
              });
            } catch (error) {
              console.error(`Failed to download video for ${video.id}:`, error.response ? error.response.data : error.message);
            }
          }
          console.log();
        }
        console.log();
      }
    } else if (action === 'list' || action === 'delete' || action === 'download') {
      const count = await getVideoCountForDate(token, date);
      console.log(`Found ${count} videos for ${date}.`);
      if (count > 0) {
        process.stdout.write(' Loading...');
      } else {
        console.log();
        return;
      }
      const videos = await getAllVideosForDate(token, date);

      for (const video of videos) {
        const favorite = video.attributes.favorite ? 'true' : 'false';

        console.log(`\n\nTitle:     ${video.attributes.title}`);
        console.log(`ID:        ${video.id}`);
        console.log(`Favorite:  ${favorite}`);
        console.log(`Uploaded:  ${video.attributes.formatted_recorded_at}`);
        console.log(`Duration:  ${video.attributes.duration} s`);
        console.log(`Thumbnail: ${video.attributes.image_url}`);
        console.log(`Video:     ${video.attributes.video_url}`);

        if (action === 'delete') {
          if (video.attributes.favorite) {
            console.log(`\nNot deleting ${video.id}.`);
          } else {
            console.log(`\nDeleting ${video.id}...`);
            if ((await deleteVideoById(token, video.id)) !== -1) {
              console.log('done.');
            } else {
              console.log('failed.');
            }
          }
        } else if (action === 'download') {
          if (!video.attributes.favorite) {
            console.log(`\nNot downloading ${video.id}.`);
          } else {
            console.log(`\nDownloading ${video.id}.`);

            const csvPath = path.join(config.DOWNLOAD_PATH, `${video.id}.csv`);
            console.log(`Metadata:  ${csvPath}`);
            fs.writeFileSync(csvPath, `id,title,favorite,uploaded,duration,thumbnail,video\n${video.id},${video.attributes.title},${favorite},${video.attributes.formatted_recorded_at},${video.attributes.duration} s,${video.attributes.image_url},${video.attributes.video_url}\n`);

            const thumbPath = path.join(config.DOWNLOAD_PATH, `${video.id}.jpg`);
            console.log(`Thumbnail: ${thumbPath}`);
            try {
              const responseThumb = await axios({
                url: video.attributes.image_url,
                method: 'GET',
                responseType: 'stream'
              });
              const thumbStream = fs.createWriteStream(thumbPath);
              responseThumb.data.pipe(thumbStream);
              await new Promise((resolve, reject) => {
                thumbStream.on('finish', resolve);
                thumbStream.on('error', reject);
              });
            } catch (error) {
              console.error(`Failed to download thumbnail for ${video.id}:`, error.response ? error.response.data : error.message);
            }

            const videoPath = path.join(config.DOWNLOAD_PATH, `${video.id}.mp4`);
            console.log(`Video:     ${videoPath}`);
            try {
              const responseVideo = await axios({
                url: video.attributes.video_url,
                method: 'GET',
                responseType: 'stream'
              });
              const videoStream = fs.createWriteStream(videoPath);
              responseVideo.data.pipe(videoStream);
              await new Promise((resolve, reject) => {
                videoStream.on('finish', resolve);
                videoStream.on('error', reject);
              });
            } catch (error) {
              console.error(`Failed to download video for ${video.id}:`, error.response ? error.response.data : error.message);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('An error occurred:', error.message);
    // Handle unexpected errors but keep the script running
  }
})();
