import { v2 as cloudinary } from "cloudinary";
import fs from 'fs';

//cloudinary configuration
cloudinary.config(
    {
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    }
)

//function for uploading files in cloudinary
const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) {
            return null
        }
        else {
            //upload file 
            const response = await cloudinary.uploader.upload(localFilePath, {
                resource_type:"auto"
            })
            console.log('File is uploaded on cloudinary successfully !', response.url)
            fs.unlinkSync(localFilePath)
            return response
        }
    } catch (error) {
        //remove that file from local server
        console.log("Something wrong in cloudinary.js", error)
        fs.unlinkSync(localFilePath)
        return null
    }
}


export {uploadOnCloudinary}