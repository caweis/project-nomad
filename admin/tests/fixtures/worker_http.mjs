import axios from 'axios'
import http from 'node:http'
// Test-only DNS for a real local HTTP fixture. Production URL validation is unchanged.
axios.defaults.httpAgent = new http.Agent({
  lookup(hostname, options, callback) {
    if (hostname !== 'fixture.nomad.test') return callback(new Error('Unexpected smoke-test host'))
    if (options.all) return callback(null, [{ address: '127.0.0.1', family: 4 }])
    callback(null, '127.0.0.1', 4)
  },
})
axios.defaults.proxy = false
