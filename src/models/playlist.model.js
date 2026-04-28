import mongoose, { Schema } from "mongoose";

const playlistSchema = new Schema({
    //name of the playlist
    name: {
        type: String,
        required: true
    },

    //describe playlist
    description: {
        type: String,
        required: true
    },

    //videos list in playlist
    videos: [
        {
            type: Schema.Types.ObjectId,
            ref: "Video"
        }
    ],

    //owner of the playlist
    owner: {
        type: Schema.Types.ObjectId,
        ref: "User"
    }

}, {timestamps: true})

export const Playlist = mongoose.model("Playlist", playlistSchema)