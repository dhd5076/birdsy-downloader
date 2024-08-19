/*More or less a 1 for 1 copy of onedayfishsales original script rewritten in JS since I'm more 
familiar with it and had difficulty debugging perl since I havent used it in years */
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
    console.error('Failed to get auth token:', error);
    return -1;
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
    console.error('Failed to get video counts:', error);
    return -1;
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
    console.error('Failed to get video count for date:', error);
    return -1;
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
      console.error('Failed to get videos for date:', error);
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
    console.error('Failed to delete video:', error);
    return -1;
  }
}

// Main function
(async function main() {
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
          const responseThumb = await axios({
            url: video.attributes.image_url,
            method: 'GET',
            responseType: 'stream'
          });
          responseThumb.data.pipe(fs.createWriteStream(thumbPath));

          console.log(`Video:     ${videoPath}`);
          const responseVideo = await axios({
            url: video.attributes.video_url,
            method: 'GET',
            responseType: 'stream'
          });
          responseVideo.data.pipe(fs.createWriteStream(videoPath));
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
          const responseThumb = await axios({
            url: video.attributes.image_url,
            method: 'GET',
            responseType: 'stream'
          });
          responseThumb.data.pipe(fs.createWriteStream(thumbPath));

          const videoPath = path.join(config.DOWNLOAD_PATH, `${video.id}.mp4`);
          console.log(`Video:     ${videoPath}`);
          const responseVideo = await axios({
            url: video.attributes.video_url,
            method: 'GET',
            responseType: 'stream'
          });
          responseVideo.data.pipe(fs.createWriteStream(videoPath));
        }
      }
    }
  }
})();
