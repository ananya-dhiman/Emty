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
        email: { type: String, required: true, unique: true },
        name: String,
        avatar: String,
        firebaseId: { type: String, required: true, unique: true },
    },
    { timestamps: true }
);

export const UserModel = mongoose.model<IUser>("User", UserSchema);

export const User = {
    async findUnique(args: { where: { id?: string; firebaseId?: string; email?: string } }) {
        const where = args.where || {};
        if (where.id) return UserModel.findById(where.id).lean<IUser | null>();
        if (where.firebaseId) return UserModel.findOne({ firebaseId: where.firebaseId }).lean<IUser | null>();
        if (where.email) return UserModel.findOne({ email: where.email }).lean<IUser | null>();
        return null;
    },
};
