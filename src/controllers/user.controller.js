import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import jwt from "jsonwebtoken"
import mongoose from "mongoose";

const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        //adding value to refreshToken in DB
        user.refreshToken = refreshToken
        //saving that value in DB
        await user.save({ validateBeforeSave: false })

        return { accessToken, refreshToken }

    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating refresh and access token")
    }
}

const registerUser = asyncHandler(async (req, res) => {
    //get user details from Client/Frontend
    const { fullName, email, username, password } = req.body

    //validation of data
    if ([fullName, email, username, password].some((field) => { field?.trim() === "" })) {
        throw new ApiError(400, "field is required !!") //new -> creates a new object from that class
    }

    //check if user already exists: username, email
    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    })
    if (existedUser) {
        throw new ApiError(409, "user with this username or email already existed")
    }

    //check for images, check for avatar(because it is compulsory)
    const avatarLocalPath = req.files?.avatar[0]?.path
    //const coverImageLocalPath = req.files?.coverImage[0]?.path
    let coverImageLocalPath
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, 'avatar file is required')
    }

    //upload them to cloudinary, avatar
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    if (!avatar) {
        throw new ApiError(400, "avatar file is required !")
    }

    //create user object - create entry in DB
    const user = await User.create({
        fullName: fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email: email,
        password: password,
        username: username.toLowerCase()
    })
    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken" //remove password and refreshToken fields from response
    )

    //check for user creation
    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user")
    }

    //return response
    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered Successfully !!")
    )
})

const loginUser = asyncHandler(async (req, res) => {
    //take data from client
    const { email, username, password } = req.body

    //username or email
    if (!username && !email) {
        throw new ApiError(400, "username or email required")
    }

    //Here is an alternative of above code based on logic discussed
    // if (!(username || email)) {
    //     throw new ApiError(400, "username or email required")
    // }


    //find the user
    const user = await User.findOne({
        $or: [{ username }, { email }]
    })
    if (!user) {
        throw new ApiError(404, "User does not exist")
    }

    //check password
    const isPasswordValid = await user.isPasswordCorrect(password)
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid user crediantials")
    }

    //generate access and refresh token 
    const { accessToken, refreshToken } = await generateAccessAndRefreshToken(user._id)

    const loggedInUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    //send it to user (in cookies)
    const options = {
        httpOnly: true,
        secure: true
    }

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(200, {
                user: loggedInUser, accessToken, refreshToken
            },
                "User logged in Successfully"
            )
        )

})

const logoutUser = asyncHandler(async (req, res) => {
    //update refreshToken to empty in DB
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: {
                refreshToken: 1 //this removes the field from document
            }
        },
        {
            new: true
        }
    )

    //clear cookies
    const options = {
        httpOnly: true,
        secure: true
    }

    return res.status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, {}, "User logged out successfully"))
})

const generateNewAccessTokenByUsingRefreshToken = asyncHandler(async (req, res) => {
    //getting refreshToken from client cookies
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken
    if (!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorized request")
    }

    try {
        //decode the token to get refreshToken payload (i.e. '_id' here)
        const decodeToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)

        //finding user details
        const user = await User.findById(decodeToken?._id)
        if (!user) {
            throw new ApiError(401, "Invalid Refresh Token")
        }

        //matching the user sent refreshToken with the refreshToken that present in DB
        if (incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, "Refresh Token is expired or used")
        }

        //generating new AccessToken and refreshToken
        const { accessToken, newRefreshToken } = await generateAccessAndRefreshToken(user._id)

        //sending response
        const options = {
            httpOnly: true,
            secure: true
        }
        return res.status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(
                new ApiResponse(200,
                    { accessToken, refreshToken: newRefreshToken },
                    "Access token refreshed"
                )
            )
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token")
    }

})

const changeCurrentPassword = asyncHandler(async (req, res) => {
    //checking user is loggedIn or not, cookies is present or not -> For that, we use verifyJWT middleware in routing

    //taking data from user
    const { oldPassword, newPassword } = req.body

    //find User 
    const user = await User.findById(req.user?._id)

    //checking password is correct or not
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)
    if (!isPasswordCorrect) {
        throw new ApiError(400, "Invalid old password")
    }

    //setting and saving the newPassword in DB
    user.password = newPassword
    await user.save({ validateBeforeSave: false })

    //sending response
    return res.status(200)
        .json(
            new ApiResponse(200, {}, "Password changed successfully")
        )
})

const getCurrentUser = asyncHandler(async (req, res) => {
    return res.status(200)
        .json(new ApiResponse(200, req.user, "Current user fetched successfully"))
})

//updating text based data
const updateAccountDetails = asyncHandler(async (req, res) => {
    //taking data from user to update (it's totally depend upon you, what u are allowing to change)
    const { fullName, email } = req.body
    if (!fullName || !email) {
        throw new ApiError(400, "All fields are required")
    }

    //find user and update the details
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullName: fullName,
                email: email
            }
        },
        {
            new: true //it returns the data after update
        }
    ).select("-password")

    //sending response
    return res.status(200)
        .json(new ApiResponse(200, user, "Account details updated successfully"))
})

//updating file based data (you can do it in the above function also, but it's not a good approach. So do it separately) -[here, file is "avatar"]
const updateUserAvatar = asyncHandler(async (req, res) => {
    //NOTE: using middleware in this order: verifyJWT -> multer -> this method (it is done in routes)

    //taking file from user
    const avatarLocalPath = req.file?.path
    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is missing")
    }

    //upload that file in cloudinary
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    if (!avatar.url) {
        throw new ApiError(400, "Error while uploading on avatar")
    }

    //updating on DB
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                avatar: avatar.url
            }
        },
        { new: true }
    ).select("-password")

    //sending response
    return res.status(200)
        .json(
            new ApiResponse(200, user, "Avatar updated successfully")
        )
})

//updating file based data (you can do it in the above function also, but it's not a good approach. So do it separately) -[here, file is "covermage"]
const updateUsercoverImage = asyncHandler(async (req, res) => {
    //NOTE: using middleware in this order: verifyJWT -> multer -> this method (it is done in routes)

    //taking file from user
    const coverImageLocalPath = req.file?.path
    if (!coverImageLocalPath) {
        throw new ApiError(400, "coverImage file is missing")
    }

    //upload that file in cloudinary
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    if (!coverImage.url) {
        throw new ApiError(400, "Error while uploading on coverImage")
    }

    //updating on DB
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                coverImage: coverImage.url
            }
        },
        { new: true }
    ).select("-password")

    //sending response
    return res.status(200)
        .json(
            new ApiResponse(200, user, "Cover image updated successfully")
        )
})

//getting profile values (like: fullName, username, avatar, coverImage, email, subscribersCount, channelsSubscribedToCount, isSubscribed) by using aggregation pipeline
const getUserChannelProfile = asyncHandler(async (req, res) => {
    //Get username from URL
    const { username } = req.params
    //Validation
    if (!username?.trim()) {
        throw new ApiError(400, "username is missing")
    }

    //Start Aggregation(Running aggregation on User collection.)
    const channel = await User.aggregate([
        //Find user whose username matches.
        {
            $match: {
                username: username?.toLowerCase()
            }
        },


        /*
        These are people who subscribed to this channel.
        Meaning:
        [Go to subscriptions collection]
        [Find docs where: subscriptions.channel == user._id)]
        Store results in: subscribers: [ ... ]
        */
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },


        /*
        Channels this user has subscribed to.
        Meaning:
        [Go to subscriptions collection]
        [Find docs where: subscriptions.subscriber == user._id]
        Store results in: subscribedTo: [ ... ]
        */
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            //adding some new fields in User, so we can access all fields at one place
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                channelsSubscribedToCount: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    /*
                    condition check:
                    Meaning:
                    👉 If current user id exists inside subscribers list → true
                    👉 Else → false
                    */
                    $cond: {
                        if: { $in: [req.user?._id, "$subscribers.subscriber"] },
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            //sending only these fields for User Profile(Only send these fields in response. Hides everything else (password, tokens, etc.))
            $project: {
                fullName: 1,
                username: 1,
                avatar: 1,
                coverImage: 1,
                email: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1
            }
        }
    ])

    //validation
    if (!channel?.length) {
        throw new ApiError(404, "channel does not exists")
    }

    //sending response
    return res
        .status(200)
        .json(
            new ApiResponse(200, channel[0], "User channel fetched successfully")
        )
})

//getting watchHistory details
const getWatchHistory = asyncHandler(async (req, res) => {
    //Aggregation(Running aggregation on User collection.)
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    //Sending response
    return res
    .status(200)
    .json(
        new ApiResponse(200, user[0].watchHistory, "watch history fetched successfully")
    )
})



export {
    registerUser,
    loginUser,
    logoutUser,
    generateNewAccessTokenByUsingRefreshToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUsercoverImage,
    getUserChannelProfile,
    getWatchHistory
}