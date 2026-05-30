import { defineConfig } from '@adonisjs/core/bodyparser'

const bodyParserConfig = defineConfig({
  /**
   * The bodyparser middleware will parse the request body
   * for the following HTTP methods.
   */
  allowedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],

  /**
   * Config for the "application/x-www-form-urlencoded"
   * content-type parser
   */
  form: {
    convertEmptyStringsToNull: true,
    types: ['application/x-www-form-urlencoded'],
  },

  /**
   * Config for the JSON parser
   */
  json: {
    convertEmptyStringsToNull: true,
    types: [
      'application/json',
      'application/json-patch+json',
      'application/vnd.api+json',
      'application/csp-report',
    ],
  },

  /**
   * Config for the "multipart/form-data" content-type parser.
   * File uploads are handled by the multipart parser.
   */
  multipart: {
    /**
     * Enabling auto process allows bodyparser middleware to
     * move all uploaded files inside the tmp folder of your
     * operating system
     */
    autoProcess: true,
    convertEmptyStringsToNull: true,
    processManually: [],

    /**
     * Maximum limit of data to parse including all files and fields.
     *
     * Raised from 20mb to 250mb to accommodate the Workshop STL/3MF upload
     * (200mb per-file cap + multipart boundary overhead). Bodyparser streams
     * multipart bodies to OS tmp, so this is a request-size guard rather than
     * a memory allocation. Per-endpoint validators still enforce tighter
     * caps (Workshop upload validates `size: '200mb'`; RAG upload is bounded
     * by the embedding pipeline's own checks).
     */
    limit: '250mb',
    types: ['multipart/form-data'],
  },
})

export default bodyParserConfig
