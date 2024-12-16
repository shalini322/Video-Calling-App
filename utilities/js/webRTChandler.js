import * as wss from './wss.js'
import * as constants from "./constants.js";
import * as ui from "./ui.js";
import * as store from './store.js';

let connectedUserDetails;
let peerConnection;
let dataChannel;

const defaultConstraints = {
    audio: true,
    video: true
}
const rtcConfiguration = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:13902"
        }
    ]
}
export const getLocalPreview = () => {
    navigator.mediaDevices.getUserMedia(defaultConstraints)
        .then((stream) => {
            ui.updateLocalVideo(stream);
            ui.showVideoCallButtons();
            store.setCallState(constants.callState.CALL_AVAILABLE)
            store.setLocalStream(stream);
        }).catch((err) => {
        console.log("error occurred when trying to get an access to camera", err);
    });
}

export const createPeerConnection = () => {
    peerConnection = new RTCPeerConnection(rtcConfiguration);
    dataChannel = peerConnection.createDataChannel("chat");

    peerConnection.ondatachannel = (events) => {
        const dataChannel = events.channel;

        dataChannel.onopen = () => {
            console.log("peer connection is ready to receive data channel messages");
        }

        dataChannel.onmessage = (event) => {
            const message = JSON.parse(event.data);
            ui.appendMessage(message.message, false);
        }
    }
    peerConnection.onicecandidate = (events) => {
        if (events.candidate) {
            // send out ice candidates to another peer
            wss.sendDataUsingWebRTCSignaling({
                connectedUserSocketId: connectedUserDetails.socketId,
                type: constants.webRTCSignaling.ICE_CANDIDATE,
                candidate: events.candidate
            })
        }
    }

    peerConnection.onconnectionstatechange = (events) => {
        if (peerConnection.connectionState === "connected") {
            console.log("successfully connected with other peer", events);
        }
    }

    // receiving tracks
    const remoteStream = new MediaStream();
    store.setRemoteStream(remoteStream);
    ui.updateRemoteVideo(remoteStream);

    peerConnection.ontrack = (events) => {
        remoteStream.addTrack(events.track);
    }

    // add out stream to peer connection
    if (connectedUserDetails.callType === constants.callType.VIDEO_PERSONAL_CODE ||
    connectedUserDetails.callType === constants.callType.VIDEO_STRANGER) {
        const localStream = store.getState().localStream;

        for (const track of localStream.getTracks()) {
            peerConnection.addTrack(track, localStream);
        }
    }
}

export const sendMessageUsingDataChannel = (message) => {
    dataChannel.send(JSON.stringify({message}));
}

export const sendPreOffer = (callType, calleePersonalCode) => {
    connectedUserDetails = {
        callType,
        socketId: calleePersonalCode
    }

    if (callType === constants.callType.CHAT_PERSONAL_CODE || callType === constants.callType.VIDEO_PERSONAL_CODE) {
        const data = {
            callType, calleePersonalCode
        }
        ui.showCallingDialog(callingDialogRejectCallHandler);
        store.setCallState(constants.callState.CALL_UNAVAILABLE);
        wss.sendPreOffer(data);
    }

    if (callType === constants.callType.VIDEO_STRANGER ||
        callType === constants.callType.CHAT_STRANGER){
        const data = {
            callType, calleePersonalCode
        }
        store.setCallState(constants.callState.CALL_UNAVAILABLE);
        wss.sendPreOffer(data);
    }
}

export const handlePreOffer = (data) => {
    const {callType, callerSocketId} = data;

    if (!checkCallPossibility()){
        return sendPreOfferAnswer(constants.preOfferAnswer.CALL_UNAVAILABLE, callerSocketId);
    }
    connectedUserDetails = {
        socketId: callerSocketId,
        callType
    }

    store.setCallState(constants.callState.CALL_UNAVAILABLE);
    if (callType === constants.callType.CHAT_PERSONAL_CODE ||
        callType === constants.callType.VIDEO_PERSONAL_CODE) {
        ui.showIncomingCallDialog(callType, acceptCallHandler, rejectCallHandler);
    }
    if (callType === constants.callType.VIDEO_STRANGER ||
        callType === constants.callType.CHAT_STRANGER){
        createPeerConnection();
        sendPreOfferAnswer(constants.preOfferAnswer.CALL_ACCEPTED);
        ui.showCallElements(connectedUserDetails.callType);
    }
}
const sendPreOfferAnswer = (preOfferAnswer, callerSocketId = null) => {
    const data = {
        callerSocketId: callerSocketId ? callerSocketId : connectedUserDetails.socketId,
        preOfferAnswer
    }

    ui.removeAllDialogs();
    wss.sendPreOfferAnswer(data);
}

export const handlePreOfferAnswer = (data) => {
    const {preOfferAnswer} = data;
    ui.removeAllDialogs();
    if (preOfferAnswer === constants.preOfferAnswer.CALLEE_NOT_FOUND) {
        // show dialog callee not found
        ui.showInfoDialog(preOfferAnswer);
        setIncomingCallsAvailable();
    }

    if (preOfferAnswer === constants.preOfferAnswer.CALL_UNAVAILABLE) {
        // show dialog callee not available
        ui.showInfoDialog(preOfferAnswer);
        setIncomingCallsAvailable();
    }

    if (preOfferAnswer === constants.preOfferAnswer.CALL_REJECTED) {
        // show dialog callee rejected
        ui.showInfoDialog(preOfferAnswer);
        setIncomingCallsAvailable();
    }

    if (preOfferAnswer === constants.preOfferAnswer.CALL_ACCEPTED) {
        // send webRTC offer
        ui.showCallElements(connectedUserDetails.callType);
        createPeerConnection();
        sendWebRTCOffer();
    }
}

export const sendWebRTCOffer = async () => {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    wss.sendDataUsingWebRTCSignaling({
        connectedUserSocketId: connectedUserDetails.socketId,
        type: constants.webRTCSignaling.OFFER,
        offer: offer
    });
}

export const handleWebRTCOffer = async (data) => {
    createPeerConnection()
    await peerConnection.setRemoteDescription(data.offer);
    const answer = await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(answer);
    wss.sendDataUsingWebRTCSignaling({
        connectedUserSocketId: connectedUserDetails.socketId,
        type: constants.webRTCSignaling.ANSWER,
        answer: answer
    })
}

export const handleWebRTCAnswer = async (data) => {
    await peerConnection.setRemoteDescription(data.answer);
}

export const handleWebRTCCandidate = async (data) => {
    try {
        await peerConnection.addIceCandidate(data.candidate);
    } catch (err) {
        console.error("error occurred when trying to add ice candidate", err);
    }
}
const acceptCallHandler = () => {
    sendPreOfferAnswer(constants.preOfferAnswer.CALL_ACCEPTED);
    ui.showCallElements(connectedUserDetails.callType);
}

const rejectCallHandler = () => {
    setIncomingCallsAvailable();
    sendPreOfferAnswer(constants.preOfferAnswer.CALL_REJECTED);
}

const callingDialogRejectCallHandler = () => {
    const data = {
        connectedUserSocketId: connectedUserDetails.socketId
    };
    closePeerConnectionAndResetState();
    wss.sendUserHangedUp(data);
}

let screenSharingStream;
let remoteStream;
export const switchBetweenCameraAndScreenSharing = async (screenSharingActive) => {
    if (screenSharingActive) {
        const localStream = store.getState().localStream;

        // replace track which sender is sending
        const senders = peerConnection.getSenders();
        const sender = senders.find((sender) => sender.track.kind === localStream.getVideoTracks()[0].kind)
        if (sender) {
            sender.replaceTrack(localStream.getVideoTracks()[0]);
        }

        // stop screen sharing stream
        store.getState()
            .screenSharingStream
            .getTracks()
            .forEach((track) => track.stop());

        store.setScreenSharingActive(!screenSharingActive);
        ui.updateLocalVideo(localStream);
    } else {
        try {
            screenSharingStream = await navigator.mediaDevices.getDisplayMedia({
                video: true
            });
            store.setScreenSharingStream(screenSharingStream);

            // replace track which sender is sending
            const senders = peerConnection.getSenders();
            const sender = senders.find((sender) => sender.track.kind === screenSharingStream.getVideoTracks()[0].kind)
            if (sender) {
                sender.replaceTrack(screenSharingStream.getVideoTracks()[0]);
            }

            store.setScreenSharingActive(!screenSharingActive);
            ui.updateLocalVideo(screenSharingStream);
        } catch (e) {
            console.error("error occurred when trying to get screen sharing stream", e);
        }
    }
}

// hang up
export const handleHangUp = () => {
    const data = {
        connectedUserSocketId: connectedUserDetails.socketId
    }
    closePeerConnectionAndResetState();
    wss.sendUserHangedUp(data);
}

export const handleConnectedUserHangedUp = () => {
    closePeerConnectionAndResetState();
}

const closePeerConnectionAndResetState = () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // active mic and camera
    if (connectedUserDetails.callType === constants.callType.VIDEO_PERSONAL_CODE || connectedUserDetails.callType.VIDEO_STRANGER) {
        store.getState().localStream.getVideoTracks()[0].enabled = true;
        store.getState().localStream.getAudioTracks()[0].enabled = true;
    }
    ui.updateUIAfterHangUp(connectedUserDetails.callType);
    setIncomingCallsAvailable();
    connectedUserDetails = null;
}

const checkCallPossibility = (callType) => {
    const callState = store.getState().callState;

    if (callState === constants.callState.CALL_AVAILABLE){
        return true;
    }

    if ((callType === constants.callType.VIDEO_PERSONAL_CODE || callType === constants.callType.VIDEO_STRANGER)
        && callState === constants.callState.CALL_AVAILABLE_ONLY_CHAT){
        return false;
    }

    return false;
}

const setIncomingCallsAvailable = () => {
    const localStream = store.getState().localStream;
    if (localStream){
        store.setCallState(constants.callState.CALL_AVAILABLE);
    } else {
        store.setCallState(constants.callState.CALL_AVAILABLE_ONLY_CHAT);
    }
}