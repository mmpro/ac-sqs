const _ = require('lodash')
const async = require('async')

const AWS = require('aws-sdk')
const uuidV4 = require('uuid/v4')

const acsqs = () => {

  const sqsConfig = {
    account: '123455',
    bucket: 'sqs.admiralcloud.com',
    threshold: 250000,
    lists: [
      { name: 'playerlog', prefix: 'playerlog', processingInterval: 8000 },
      { name: 'downloadlog', prefix: 'downloadlog', perCustomer: true, processingInterval: 5000 }
    ],
    environment: process.env.NODE_ENV || 'development',
    localDevelopment: false,
    accessKeys: [],
    debug: false,
    // logger:  // Winston log instance
  }

  const init = (params) => {
    _.forEach(params, (val, key) => {
      if (_.has(sqsConfig, key) && val) _.set(sqsConfig, key, val)
    })
  }

  const generateURL = (params) => {
    const region = _.get(params, 'region', 'eu-central-1')
    const account = _.get(params, 'account', _.get(sqsConfig, 'account'))
    const queueName = generateQueueName(params)
    if (!account || !queueName) return null
    const url = 'https://sqs.' + region + '.amazonaws.com/' + account + '/' + queueName
    return url
  }

  /**
   * Generate the queuename based on list, fifo, env
   */
  const generateQueueName = (params) => {
    const queueName = (sqsConfig.localDevelopment ? 'local_' : '') + (sqsConfig.environment === 'test' ? 'test_' : '') + _.get(params, 'list') + (_.get(params, 'fifoQueue') ? '.fifo': '')
    return queueName
  }

  const callAWS = (params, cb) => {
    const providerConfig = _.find(sqsConfig.accessKeys, { default: true })
    const region = _.get(params, 'region', 'eu-central-1')
    const sqs = new AWS.SQS({
      accessKeyId: providerConfig.accessKeyId,
      secretAccessKey: providerConfig.secretAccessKey,
      region
    })
    const operation = _.get(params, 'operation')
    const sqsParams = _.get(params, 'sqsParams')
    if (_.get(sqsConfig, 'debug')) {
      if (_.isFunction(sqsConfig.logger)) sqsConfig.logger.debug('ACSQS | Call %s | Payload %j', operation, sqsParams)
      else console.log('ACSQS | Call %s | Payload %j', operation, sqsParams)
    }
    sqs[operation](sqsParams, cb)
  }

  const callAWSs3 = (params, cb) => {
    const providerConfig = _.find(sqsConfig.accessKeys, { default: true })
    const region = _.get(params, 'region', 'eu-central-1')
    const awsS3Client = new AWS.S3({
      accessKeyId: providerConfig.accessKeyId,
      secretAccessKey: providerConfig.secretAccessKey,
      region
    })
    const operation = _.get(params, 'operation')
    const s3Params = _.get(params, 's3Params')
    awsS3Client[operation](s3Params, cb)
  }


  /**
   * Creates a new queue
   */

  const createQueue = (params, cb) => {
    const sqsParams = {
      QueueName: generateQueueName(params),
      Attributes: {
        VisibilityTimeout: _.get(params, 'visibilityTimeout', 60).toString(),
      }
    }
    if (_.get(params, 'fifoQueue')) {
      _.set(sqsParams, 'Attributes.FifoQueue', 'true')    
    }
    if (_.get(params, 'useKMS')) {
      _.set(sqsParams, 'Attributes.KmsMasterKeyId', _.get(params, 'kmsMasterKeyId', 'alias/aws/sqs'))
      _.set(sqsParams, 'Attributes.KmsDataKeyReusePeriodSeconds', _.get(params, 'kmsDataKeyReusePeriodSeconds', 3600).toString())
    }
    if (_.get(params, 'messageRetentionPeriod')) {
      _.set(sqsParams, 'Attributes.MessageRetentionPeriod', _.get(params, 'messageRetentionPeriod').toString())    
    }
    callAWS({
      operation: 'createQueue',
      sqsParams
    }, cb)
  }

  /**
   * List queues for a given prefix
   */
  const listQueues = (params, cb) => {
    const sqsParams = {
      QueueNamePrefix: generateQueueName({ list: _.get(params, 'prefix') })
    }
    callAWS({
      operation: 'listQueues',
      sqsParams
    }, cb)
  }

   /**
   * Get SQS list attributes
   *
   * @param params.list STRING List to use
   * @param {*} cb
   */

  const getSQSQueueAttributes = (params, cb) => {
    let sqsParams = {
      QueueUrl: _.get(params, 'url', generateURL(params)),
      AttributeNames: ['All']
    }
    callAWS({
      operation: 'getQueueAttributes',
      sqsParams
    }, cb)
  }

  /**
   * Send messages to AWS SQS
   *
   * @param params.list STRING List to use
   * @param params.message STRING (string or JSON.strigify(obj))
   * @param params.delay INT Delay in seconds
   * @param {*} cb
   */

  const sendSQSMessage = (params, cb) => {
    const list = _.get(params, 'list')
    const additionalConfig = _.find(_.get(sqsConfig, 'lists'), { name: list })
    if (!_.get(params, 'region') && _.get(additionalConfig, 'region')) _.set(params, 'region', _.get(additionalConfig, 'region'))

    let message = params.message
    if (!message) return cb('sendSQSMessage_message_required')

    async.series({
      messageToS3: (done) => {
        if (message.length < _.get(sqsConfig, 'threshold')) return done()
        // transfer message to s3 and change message
        let s3Params = {
          Bucket: _.get(sqsConfig, 'bucket'),
          Key: _.get(params, 'MessageDeduplicationId', uuidV4()),
          Body: Buffer.from(message, 'utf-8'),
          ContentType: 'text/plain'
        }
        callAWSs3({
          operation: 'putObject',
          s3Params
        }, (err) => {
          if (err) return done(err)
          message = 's3:' + _.get(s3Params, 'Key')
          return done()
        })
      },
      sendMessage: (done) => {
        let sqsParams = {
          MessageBody: message,
          QueueUrl: generateURL(params)
        }
        if (_.get(params, 'messageGroupId')) _.set(sqsParams, 'MessageGroupId', _.get(params, 'messageGroupId'))
        if (_.get(params, 'deDuplicationId')) _.set(sqsParams, 'MessageDeduplicationId', _.get(params, 'deDuplicationId'))
        if (_.get(params, 'delay')) _.set(sqsParams, 'DelaySeconds', _.get(params, 'delay'))
        callAWS({
          operation: 'sendMessage',
          sqsParams
        }, done)
      }
    }, cb)
  }

  /**
   * Receive a message from SQS
   */
  const receiveSQSMessage =  (params, cb) => {
    const list = _.get(params, 'list')
    const additionalConfig = _.find(_.get(sqsConfig, 'lists'), { name: list })
    if (!_.get(params, 'region') && _.get(additionalConfig, 'region')) _.set(params, 'region', _.get(additionalConfig, 'region'))

    let sqsParams = {
      QueueUrl: _.get(params, 'url', generateURL(params)),
      MaxNumberOfMessages: _.get(params, 'batchSize', _.get(additionalConfig, 'batchSize', 1)),
      VisibilityTimeout:  _.get(params, 'visibilityTimeout',  _.get(additionalConfig, 'visibilityTimeout', 15))
    }

    let messages = []
    async.series({
      receiveMessage: (done) => {
        callAWS({
          operation: 'receiveMessage',
          sqsParams
        }, (err, result) => {
          if (err) return done(err)
          if (!_.size(result, 'Messages')) return done()
          messages = _.get(result, 'Messages')
          async.map(messages, (item, itDone) => {
            if (!_.startsWith(_.get(item, 'Body'), 's3:')) return itDone()
           
            let s3Params = {
              Bucket: _.get(sqsConfig, 'bucket'),
              Key: _.get(item, 'Body').substr(3)
            }
            callAWSs3({
              operation: 'getObject',
              s3Params
            }, (err, result) => {
              if (err) return itDone(err)
              let message =_.get(result, 'Body').toString()
              _.set(item, 'Body', message)
              _.set(item, 's3Storage', s3Params.Key)
              return itDone()
            })
          }, done)
        })
      }
    }, (err) => {
      return cb(err, messages)
    })
  }

  const deleteSQSMessage = (params, cb) => {
    const list = _.get(params, 'list')
    const additionalConfig = _.find(_.get(sqsConfig, 'lists'), { name: list })
    if (!_.get(params, 'region') && _.get(additionalConfig, 'region')) _.set(params, 'region', _.get(additionalConfig, 'region'))

    let sqsParams = {
      QueueUrl: _.get(params, 'url', generateURL(params)),
      ReceiptHandle: _.get(params, 'receiptHandle')
    }

    async.series({
      deleteMessage: (done) => {
        callAWS({
          operation: 'deleteMessage',
          sqsParams
        }, done)
      },
      deleteFromS3: (done) => {
        if (!_.get(params, 's3Storage')) return done()
        let s3Params = {
          Bucket: _.get(sqsConfig, 'bucket'),
          Key: _.get(params, 's3Storage')
        }
        callAWSs3({
          operation: 'deleteObject',
          s3Params
        }, done)
      },
    }, cb)
  }

  return {
    init,
    createQueue,
    listQueues,
    getSQSQueueAttributes,
    sendSQSMessage,
    receiveSQSMessage,
    deleteSQSMessage
  }

}
module.exports = acsqs()
