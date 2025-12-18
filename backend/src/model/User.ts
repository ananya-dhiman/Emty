import mongoose, { Schema, Document } from "mongoose";

// ================================
// User Model (Auth-level user)
// ================================
export interface IUser extends Document {
    email: string;
    name?: string;
    avatar?: string;
    createdAt: Date;
    firebaseId: string;
}

const UserSchema = new Schema<IUser>(
    {
        _id: { type: Schema.Types.ObjectId, ref: "User", required: true },
        email: { type: String, required: true, unique: true },
        name: String,
        avatar: String,
        firebaseId: { type: String, required: true, unique: true }
    },
    { timestamps: true }
);

export const UserModel = mongoose.model<IUser>("User", UserSchema);
