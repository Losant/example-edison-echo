# How to Build an Amazon Echo Clone with IBM Watson and Intel Edison

## Overview
In this project we will create an Amazon Echo clone based on the Intel Edison hardware and IBM Watson platform. During the lab we will covering the following topics:
  * Capturing audio with a USB microphone.
  * Sending audio to a Bluetooth speaker.
  * Using [Johnny-Five](https://johnny-five.io) to interface with the Edison's IO.
  * Using IBM's Watson Speech-to-Text and Text-to-Speech services.

## Getting Started
What you'll need to complete this project:
  * An [Intel Edison with Arduino Expansion Board](https://software.intel.com/en-us/iot/hardware/edison)
  * USB microphone (I used an [Audio-Technica AT2020 USB](http://www.amazon.com/s/ref=nb_sb_noss?url=search-alias%3Daps&field-keywords=AT2020+USB).)
  * Bluetooth speaker (I used an [Oontz Angle](http://smile.amazon.com/s/ref=nb_sb_noss_2?url=search-alias%3Daps&field-keywords=oontz+angle&rh=i%3Aaps%2Ck%3Aoontz+angle).)
  * An IBM Bluemix Account - [Bluemix Registration](https://console.ng.bluemix.net/registration/)
  * A working knowledge of [Node.js](https://nodejs.org)

If you haven't already done so, you'll need to setup your Edison and get the latest firmware flashed. You can follow our quick article on [Getting Started with the Intel Edison](http://www.getstructure.io/blog/getting-started-with-the-intel-edison) or check out [Intel's Getting Started Guide](https://software.intel.com/en-us/iot/library/edison-getting-started).

NOTE: I'm using the [Intel XDK IoT Edition](https://software.intel.com/en-us/iot/software/ide/intel-xdk-iot-edition) because it makes debugging and uploading code to the board very easy. To learn more about the IDE and how to get started using it check out [Getting Started with the Intel XDK IoT Edition](https://software.intel.com/en-us/getting-started-with-the-intel-xdk-iot-edition). It is not required for this project though.

## Connect Bluetooth Speaker
Establish a terminal to your Edison using either of the guides above.

Make your Bluetooth device discoverable. In my case I needed to push the pair button on the back of the speaker. <Insert pic of pairing button>

In the terminal to your board type the following:
```
root@edison:~# rfkill unblock bluetooth
root@edison:~# bluetoothctl
[bluetooth] scan on
```

This starts the Bluetooth Manager on the Edison and starts scanning for devices. The results should look something like:
```
Discovery started
[CHG] Controller 98:4F:EE:06:06:05 Discovering: yes
[NEW] Device A0:E9:DB:08:54:C4 OontZ Angle
```

Find your device in the list and pair to it.
```
[bluetooth] pair A0:E9:DB:08:54:C4
```

In some cases, the device may need to connect as well.
```
[bluetooth] connect A0:E9:DB:08:54:C4
```

Exit the Bluetooth Manager.
```
[bluetooth] quit
```

Let's verify that your device is recognized in pulse audio:
```
root@edison:~# pactl list sinks short
```

If all is good, you should see your device listed as a sink device and the name should start with `bluez_sink` like the example output below.
```
0  alsa_output.platform-merr_dpcm_dummy.0.analog-stereo  module-alsa-card.c  s16le 2ch 48000Hz  SUSPENDED
1  alsa_output.0.analog-stereo  module-alsa-card.c  s16le 2ch 44100Hz  SUSPENDED
2  bluez_sink.A0_E9_DB_08_54_C4  module-bluez5-device.c  s16le 2ch 44100Hz  SUSPENDED
```

Now let's set our Bluetooth device as the default sink for the pulse audio server:
```
root@edison:~# pactl set-default-sink bluez_sink.A0_E9_DB_08_54_C4
```

## Connect USB Microphone
The Edison has two USB modes: host mode and device mode. To use a USB microphone you'll need to switch the Edison into host mode by flipping the microswitch, located between the standard sized USB port and the micro USB port, towards the large USB port. <Insert photo of microswitch> You will also need to power the Edison with an [external DC power supply](http://www.digikey.com/product-detail/en/EMSA120150-P5P-SZ/T1091-P5P-ND/2352085) and not through the micro USB.

Then simply plug your microphone in the large USB port. <Insert photo of usb plugged in>

Let's make sure the Edison recognizes our microphone as an audio source by using the `arecord` command.
```
root@edison:~# arecord -l
```

The output contains all of the hardware capture devices available. Locate your USB Audio device and make note of its card number and device number. In the example
output below my mic is device 0 on card 2.
```
...
card 2: DSP [Plantronics .Audio 655 DSP], device 0: USB Audio [USB Audio]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
```

## Let's Get Coding
In less than 200 lines of code (including comments) we'll have a system that will:
  1. Listen for a button press
  2. Play a sound to let the user know it's listening
  3. Capture 5 seconds of audio input
  4. Convert the audio input to text
  5. Perform a command or search on the input text
  6. Convert the text results to speech
  7. Play the speech audio to the user

I've broken the code up into easy to understand blocks. Let's walk through them and explain along the way.

#### Requires and Globals
Nothing special here. Just require the modules we need and declare some vars to use a little later.

```js
// load required modules
var async = require('async');                     // helps control asynchronous flow
var path = require('path');                       // utility for handling file paths
var exec = require('child_process').exec;         // runs a command in a shell and buffers the output
var spawn = require('child_process').spawn;       // launches a child process
var request = require('request');                 // http request client
var watson = require('watson-developer-cloud');   // IBM Watson services client
var five = require('johnny-five');                // robotics programming framework
var Edison = require('edison-io');                // edison IO library
var numify = require('numstr').numify;            // english number utility

// globals
var led = null;                                   // reference to led object
var working = false;                              // keeps track of if we are already working on a command
```

#### Initialize Watson Services
Another simple block of code but this one requires a little pre-work. IBM Watson Cloud Services requires credentials for each specific service used. Follow the [Obtaining credentials for Watson services](http://www.ibm.com/smarterplanet/us/en/ibmwatson/developercloud/doc/getting_started/gs-credentials.shtml) guide to get credentials for both the Speech-To-Text and the Text-To-Speech services.

```js
// initialize watson text-to-speech service
var textToSpeech = watson.text_to_speech({
  username: '<text-to-speech username>',
  password: '<text-to-speech password>',
  version: 'v1'
});

// initialize watson speech-to-text service
var speechToText = watson.speech_to_text({
  username: '<speech-to-text username>',
  password: '<speech-to-text password>',
  version: 'v1'
});
```

#### Text-to-Speech and Speech-to-Text Magic
First let's take a look at the Text-to-Speech (TTS) function. There are two parts to TTS: 1) Converting the text to audio and 2) Playing the audio.

For the first, we are obviously using the IBM Watson Cloud Services which couldn't make it any easier. All we need to do is pass the text we would like converted and the audio format we would like back, into the `synthesize` method and it returns a [Stream](https://nodejs.org/docs/v0.10.38/api/stream.html). 

For the second, we are using [GStreamer](http://gstreamer.freedesktop.org/). More specifically, [`gst-launch`](https://www.mankier.com/1/gst-launch-1.0). We take the `Stream` returned from `synthesize` and pipe it directly into the `stdin` on the child process of `gst-launch-1.0`. GStreamer then processes it as a wav file and sends it to the default audio output.

```js
// accepts a string and reads it aloud
function tts (text, cb) {
  // build tts parameters
  var params = {
    text: text,
    accept: 'audio/wav'
  };
  // create gtstreamer child process to play audio
  // "fdsrc fd=0" says file to play will be on stdin
  // "wavparse" processes the file as audio/wav
  // "pulsesink" sends the audio to the default pulse audio sink device
  var gst = exec('gst-launch-1.0 fdsrc fd=0 ! wavparse ! pulsesink', function (err) {
    if (err) { return cb(err); }
    cb();
  });
  // use watson and pipe the text-to-speech results directly to gst
  textToSpeech.synthesize(params).pipe(gst.stdin);
}
```
Next let's look at the Speech-to-Text (STT) function. As with the TTS function, there are two main parts.

The first is capturing the audio. To capture the audio we are using [`arecord`](http://linuxcommand.org/man_pages/arecord1.html). `arecord` is fairly straightforward with the exception of the `-D` option. Earlier when we set up the USB microphone, we used `arecord -l` to confirm the system saw it. That also gave us the card and device numbers associated with the mic. In my case, the mic is device 0 on card 2. Therefor, the `-D` option is set to `hw:2,0` (hardware device, card 2, device 0.) By not providing a file to record the audio to, we are telling `arecord` to send all data to it's `stdout`.

Now we take the `stdout` from `arecord` and pass that into the `recognize` method on the STT service as the audio source. The `arecord` process will run forever unless will kill it. So we set a timeout for five seconds then kill the child process.

Once we get the STT result back, we grab the first transcript from the response, trim it and return it.

```js
// listens for audio then returns text
function stt (cb) {
  var duration = 5000;
  console.log('listening for %s ms ...', duration);
  // create an arecord child process to record audio
  var arecord = spawn('arecord', ['-D', 'hw:2,0', '-t', 'wav', '-f', 'dat']);
  // build stt params using the stdout of arecord as the audio source
  var params = {
    audio: arecord.stdout,
    content_type: 'audio/wav',
    continuous: true    // listen for audio the full 5 seconds
  };
  // use watson to get answer text
  speechToText.recognize(params, function (err, res) {
    if (err) { return cb(err); }
    var text = '';
    try {
      text = res.results[0].alternatives[0].transcript;
    } catch (e) { }
    console.log('you said: "%s"', text);
    cb(null, text.trim());
  });
  // record for duration then kill the child process
  setTimeout(function () {
    arecord.kill('SIGINT');
  }, duration);
}
```

#### Play Local Wav File
We have already covered using GStreamer but to play a local the args are a little different.

```js
// plays a local wav file
function playWav (file, cb) {
  var filePath = path.resolve(__dirname, file);
  // create gtstreamer child process to play audio
  // "filesrc location=" says use a file at the location as the src
  // "wavparse" processes the file as audio/wav
  // "volume" sets the output volume, accepts value 0 - 1
  // "pulsesink" sends the audio to the default pulse audio sink device
  exec('gst-launch-1.0 filesrc location=' + filePath + ' ! wavparse ! volume volume=0.25 ! pulsesink', function (err) {
   return cb(err);
  });
}
```

#### Setup Johnny-Five
Here we setup the Edison IO in Johnny-Five and listen for the board to complete initialization. Then attach a button to GPIO pin 4 and an LED to GPIO 6. To do this I used a [Grove Base Shield](http://www.seeedstudio.com/depot/Base-Shield-V2-p-1378.html) along with the Grove button and LED modules. <Insert photo of grove>

You can also attach a button and LED using a breadboard instead.

Last we add a listener on the button `press` event which will call the `main` function that we will look at next.

```js
// initialize edison board
var board = new five.Board({
  io: new Edison(),
  repl: false           // we don't need the repl for this project
});

// when the board is ready, listen for a button press
board.on('ready', function() {
  var button = new five.Button(4);
  led = new five.Led(6);
  led.off();
  button.on('press', main);
});
```

#### Main
We now have all the supporting pieces so let's put together the main application flow. When main is run, we first play a chime sound to let the user know we are listening using the `playWav` defined earlier. You can find download the wav file I used from [the projects repo](https://github.com/GetStructure/example-edison-echo). We then listen for a command, perform the search, and play the results which we will all look at next. 

Last we handle any errors that may have happened and get ready to do it all again.

```js
// main function
function main() {
  if (working) { return; }
  working = true;
  async.waterfall([
    async.apply(playWav, '88877_DingLing.wav'),
    listen,
    search,
    speak
  ], finish);
}

// handle any errors clear led and working flag
function finish (err) {
  if (err) {
    tts('Oops, something went wrong and I was unable to complete your request.');
    console.log(err);
  }
  // stop blinking and turn off
  led.stop().off();
  working = false;
}
```

#### The Bread-and-Butter
The `listen` function simply turns on the LED to show we are listening then calls `stt` to capture the command.

```js
// listen for the audio input
function listen (cb) {
  // turn on the led
  led.on();
  stt(cb);
}
```

The `search` function uses the [Duck Duck Go Instant Answer API](https://api.duckduckgo.com/api) to perform the search. Then returns the best answer.

```js
// perform a search using the duckduckgo instant answer api
function search (q, cb) {
  if (!q) {
    return cb(null, 'I\'m sorry I didn\'t hear you.');
  }
  // blick the led every 100 ms
  led.blink(100);
  // run the query through numify for better support of calculations in duckduckgo
  q = numify(q);
  console.log('searching for: %s', q);
  var requestOptions = {
    url: 'https://api.duckduckgo.com/',
    accept: 'application/json',
    qs: {
      q: q,
      format: 'json',
      no_html: 1,
      skip_disambig: 1
    }
  };
  request(requestOptions, function (err, res, body) {
    if (err) { return cb(err); }
    var result = JSON.parse(body);
    var text = 'I\'m sorry, I was unable to find any information on ' + q;   // default response
    if (result.Answer) {
      text = result.Answer;
    } else if (result.Definition) {
      text = result.Definition;
    } else if (result.AbstractText) {
      text = result.AbstractText;
    }
    cb(null, text);
  });
}
```

Last we have the `speak` function that takes the search results and passes that into the `tts` function.

```js
// read the search results
function speak (text, cb) {
  // stop blinking and turn off
  led.stop().off();
  if (!text) { return cb(); }
  tts(text, cb);
}
```

## Wrap Up
Deploy the code to your Edison and run it. Wait a few seconds for the app to initialize then press the button. You'll hear a sound and the LED will light up. Speak your search phrase clearly into the mic then sit back and enjoy your new toy. 

You'll find it's great at handling single words and simple phrases. You can also use it to do simple math problems by starting your phrase with "calculate", like "calculate five plus five."

Below you'll find a list of additional resources used while making this project but not linked to above. I encourage you to take a look at them to learn a little more about the technologies used. You can also find all the code for this project at https://github.com/GetStructure/example-edison-echo.

Enjoy!

## Additional Resources
  * [Structure IoT Blog](http://www.getstructure.io/blog/)
  * [Intel Edison Bluetooth Guide](http://download.intel.com/support/edison/sb/edisonbluetooth_331704004.pdf)
  * [Intel Edison Audio Setup Guide](http://download.intel.com/support/edison/sb/edisonaudio_332434001.pdf)
  * [PLAY AUDIO FROM YOUR INTEL® EDISON VIA BLUETOOTH* USING ADVANCED AUDIO DISTRIBUTION PROFILE (A2DP)](https://software.intel.com/en-us/articles/play-audio-from-your-intel-edison-via-bluetooth-using-advanced-audio-distribution-profile)
