import CPTY
import Darwin
import Foundation

// PTYSpike — does the NOMAD Installer.app's privilege handling actually work?
//
// The installer's `sudo_bootstrap()` runs `sudo -v`, and sudo reads its password
// from /dev/tty, NOT stdin — which is why a GUI process can't just pipe a
// password in. The proven workaround is to run the CLI inside a pseudo-terminal.
//
// This probe runs `sudo -k; sudo -v` inside a PTY, watches the stream for the
// "Password:" prompt, and writes a DELIBERATELY WRONG password back. sudo's
// "Sorry, try again." response is the proof our write reached its TTY read.
// Nothing is installed and no real secret is handled — the wrong password is the
// whole point. Override only for manual end-to-end checks via SPIKE_SUDO_PW.

let passwordToSend = ProcessInfo.processInfo.environment["SPIKE_SUDO_PW"]
    ?? "__deliberately_wrong_spike_password__"

// `sudo -k` clears any cached timestamp so `sudo -v` is forced to prompt, even
// if Chris ran sudo moments ago. `sudo -v` is exactly what sudo_bootstrap() runs
// and it executes no command — it only refreshes the auth timestamp.
let command = "sudo -k; echo '--- spike: forcing a sudo prompt ---'; sudo -v; echo \"SPIKE_SUDO_EXIT=$?\""

var master: Int32 = -1
let pid = command.withCString { cpty_spawn_bash($0, &master) }
guard pid > 0, master >= 0 else {
    FileHandle.standardError.write(Data("cpty_spawn_bash failed\n".utf8))
    exit(2)
}

var promptCount = 0
var repliesSent = 0
var sawTryAgain = false

let bufSize = 4096
var buf = [UInt8](repeating: 0, count: bufSize)

readLoop: while true {
    let n = read(master, &buf, bufSize)
    if n <= 0 { break readLoop } // <= 0 includes EIO, which a PTY returns when the child exits

    let chunk = String(decoding: buf[0..<n], as: UTF8.self)
    FileHandle.standardOutput.write(Data(chunk.utf8)) // live transcript

    // sudo echoes "Sorry, try again." after a rejected password — that proves the
    // bytes we wrote were consumed as a real password attempt. Proof achieved;
    // stop here so we burn exactly one failed attempt (don't answer the re-prompt).
    if chunk.contains("Sorry, try again") {
        sawTryAgain = true
        break readLoop
    }

    if chunk.contains("Password:"), repliesSent == 0 {
        promptCount += 1
        let line = passwordToSend + "\n"
        _ = line.withCString { write(master, $0, strlen($0)) }
        repliesSent += 1
    }
}

// Closing the master sends EOF to sudo's TTY read so it aborts cleanly instead of
// re-prompting into a blocked read.
close(master)
var status: Int32 = 0
waitpid(pid, &status, 0)

let pass = promptCount >= 1 && repliesSent >= 1 && sawTryAgain

print("")
print("================ PTY SPIKE VERDICT ================")
print("password prompts detected : \(promptCount)")
print("replies written to the PTY : \(repliesSent)")
print("sudo 'Sorry, try again.'   : \(sawTryAgain ? "yes — our PTY write reached sudo's /dev/tty read" : "no")")
print("--------------------------------------------------")
if pass {
    print("RESULT: PASS — PTY + sudo prompt interception works.")
    print("The app can run `nomad install` and answer its sudo prompt.")
} else {
    print("RESULT: FAIL — see the transcript above.")
    print("(If no prompt appeared, this Mac's sudoers may not require a password.)")
}
print("==================================================")

exit(pass ? 0 : 1)
