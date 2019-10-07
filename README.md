# AC SQS
This tool is a wrapper for AWS SDK's SQS function. It includes handling of big SQS messages using S3.

## Usage

```
yarn add ac-sqs
```

## Examples

```
const acsqs = require('ac-sqs')

const sqsConfig = {
  account: 'AWS ACCOUNT ID',
  accessKeys: [{
    accessKeyId: 'AWS ACCESS KEY',
    secretAccessKey: 'AWS ACCESS SECRET',
    default: true
  }],

  // optional if you want to use large messages
  bucket: 'S3 bucket for large messages',
  threshold: 250000,

  
  // Optional to init this tool with additional parameters
  lists: [
    { name: 'playerlog', prefix: 'playerlog', processingInterval: 8000 },
  ],

  
  localDevelopment: false, // if true, list will be prefixed with "local_"
  debug: false // if true, logs will be written for every SQS call
}

acsqs.init(sqsConfig)

acsqs.listQueues({
  prefix: 'someSQSlist'
}, (err, result) => {
  console.log(23, err, result)
})

```

## ToDos
+ improve README

## Links
- [Website](https://www.admiralcloud.com/)
- [Twitter (@admiralcloud)](https://twitter.com/admiralcloud)
- [Facebook](https://www.facebook.com/MediaAssetManagement/)


## License
[MIT License](https://opensource.org/licenses/MIT) Copyright © 2009-present, AdmiralCloud, Mark Poepping
