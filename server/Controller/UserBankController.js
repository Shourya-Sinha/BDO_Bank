import Transaction from "../Model/Transactions.js";
import UserBank from "../Model/userBank.js";
import { v4 as uuidv4 } from "uuid";
import User from "../Model/UserModel.js";
import mongoose from "mongoose";

const generateAccountNumber = () => {
    return `${Date.now().toString().slice(-6)}${Math.floor(
        100000 + Math.random() * 900000
    )}`;
};

const calculateTransactionFees = (amount, bankType) => {
    let fee = 0;

    // If it's a SameBank transfer, the fee is 10 PHP
    if (bankType === 'SameBank') {
        fee = 5; // SameBank transactions have a fixed fee of 10 PHP
    }
    // If it's an External transfer, the fee is 25 PHP
    else if (bankType === 'External') {
        fee = 25; // External transactions have a fixed fee of 25 PHP
    }

    return fee;
};
export const createTransaction = async (req, res) => {
    try {
        const { fromAccount, toAccount, amount, transactionType, bankType, note, externalBankDetails } = req.body;

        const senderTransactionType = 'Withdraw'; // Sender is withdrawing money
        const receiverTransactionType = 'Deposit'; // Receiver is depositing money

        const transactionFees = calculateTransactionFees(amount, bankType);
        const transactionAmount = Math.round(Number(amount) * 100) / 100;

        if (isNaN(transactionAmount) || transactionAmount <= 0) {
            return res.status(400).json({ status: "error", message: "Amount must be a valid positive number." });
        }

        // Find sender account by accountNumber
        const senderAccount = await UserBank.findOne({ accountNumber: fromAccount }).populate("userId");
        if (!senderAccount) {
            return res.status(404).json({ status: "error", message: "Sender account not found." });
        }

        let receiverAccount = null;
        let updatedSenderBalance = senderAccount.balance;
        let updatedReceiverBalance = null;
        let toAccountValue = null;

        // Handle deposit and withdrawal for SameBank or External bank types
        if (transactionType === "Withdraw") {
            if (senderAccount.balance < transactionAmount + transactionFees) {
                return res.status(400).json({ status: "error", message: "Insufficient balance." });
            }
            updatedSenderBalance -= (transactionAmount + transactionFees); // Withdraw from sender account
        } else if (transactionType === "Deposit") {
            updatedSenderBalance += transactionAmount; // Deposit to sender account
        }

        // Handle SameBank transfer
        if (bankType === "SameBank") {
            receiverAccount = await UserBank.findOne({ accountNumber: toAccount });
            if (!receiverAccount) {
                return res.status(404).json({ status: "error", message: "Receiver account not found." });
            }

            receiverAccount.balance += transactionAmount; // Transfer amount to receiver account
            updatedReceiverBalance = receiverAccount.balance;
            await receiverAccount.save();

            toAccountValue = receiverAccount._id;
        }

        // Handle External bank transfer (Requires external details)
        if (bankType === "External") {
            if (!externalBankDetails || !externalBankDetails.accountNumber) {
                return res.status(400).json({ status: "error", message: "External bank details are required." });
            }
            // Process external transfer logic here (you might not update the receiver account in the system)
            updatedReceiverBalance = null; // No balance change in the system for external transfers
            toAccountValue = externalBankDetails.accountNumber;
        }

        // Update sender account balance
        senderAccount.balance = updatedSenderBalance;
        await senderAccount.save();

        // Create Transaction Entry for Sender (Withdraw)
        const senderTransaction = new Transaction({
            transactionId: uuidv4(),
            fromAccount: senderAccount._id,  // Sender account
            //toAccount: receiverAccount ? receiverAccount._id : externalBankDetails?.accountNumber || null,
            toAccount:toAccountValue,
            amount: transactionAmount,
            transactionType: senderTransactionType, // Withdraw for sender
            bankType,
            externalBankDetails: bankType === 'External' ? externalBankDetails : null,
            note,
            status: "Success",
            transactionDate: new Date(),
            charges: transactionFees, // Set charges for sender
        });

        // Save the sender transaction
        await senderTransaction.save();

        // If it's a SameBank transfer, create receiver's transaction (Deposit)
        if (bankType === 'SameBank') {
            const receiverTransaction = new Transaction({
                transactionId: uuidv4(),
                fromAccount: receiverAccount._id,
                toAccount: senderAccount._id,
                amount: transactionAmount,
                transactionType: receiverTransactionType, // Deposit for the receiver
                bankType,
                externalBankDetails: null,
                note,
                status: "Success",
                transactionDate: new Date(),
                charges: 0, // No charges for the receiver
            });

            // Save the receiver transaction
            await receiverTransaction.save();
        }

        return res.status(201).json({
            status: "success",
            message: "Transaction successful",
            transaction: senderTransaction,
            senderBalance: updatedSenderBalance,
            receiverBalance: updatedReceiverBalance || null
        });

    } catch (error) {
        console.error("Transaction Error:", error);
        return res.status(500).json({ status: "error", message: "Transaction failed" });
    }
};

export const createBankAcountByUser = async (req, res, next) => {
    try {
        const { userId, firstName, lastName, dateOfBirth, phoneNo, address, email } =
            req.body;
        let user;
        if (userId) {
            user = await User.findById(userId);
        } else {
            user = await User.findOne({ email });
        }

        if (!user) {
            return res
                .status(404)
                .json({ status: "error", message: "User not found." });
        }

        if (user.isBlocked) {
            return res
                .status(403)
                .json({ status: "error", message: "User is blocked." });
        }

        const GeneratedAccountNumber = generateAccountNumber();
        const userName = `${user.firstName} ${user.lastName}`;

        const firstPart = user.firstName?.length > 2 ? user.firstName.slice(1, 3) : user.firstName || "";
        const lastPart = user.lastName?.length > 2 ? user.lastName.slice(2) : user.lastName || "";
        const branchNameCreated = `${firstPart}${lastPart}`;

        const IfscCode = `BDO${Math.floor(10000 + Math.random() * 90000)}${branchNameCreated.slice(0, 3)}`;

        const newBankAccount = new UserBank({
            userId: user._id,
            bankName: "BDO",
            branchName: branchNameCreated,
            accountNumber: GeneratedAccountNumber,
            accountName: userName,
            accountType: "Savings",
            currency: "PHP",
            ifscCode: IfscCode,
            createdBy: user._id,
            balance: 0,
        });
        await newBankAccount.save();

        const userData = await User.findByIdAndUpdate(
            { _id: userId ? userId : user._id },
            {
                firstName,
                lastName,
                address,
                phoneNo,
                dateOfBirth,
                isBankAccountCreated: true
            },
            { new: true } // ✅ This ensures you get the updated document
        );
        if (!userData) {
            return res
                .status(500)
                .json({ status: "error", message: "Failed to create bank account. Problem in your Name" });
        }
        await userData.save();

        return res.status(201).json({
            status: "success",
            message: "Bank account created successfully.",
            data: {
                accountName: userName,
                branchName: branchNameCreated, // ✅ Fixed
                accountNumber: GeneratedAccountNumber, // ✅ Fixed
                ifscCode: IfscCode, // ✅ Fixed
            },
        });
    } catch (error) {
        console.error("Create Bank Account Error:", error);
        return res
            .status(500)
            .json({
                status: "error",
                message: "Failed to create bank account.",
                error,
            });
    }
};

export const getBankAccountDetails = async (req, res) => {
    try {
        const userId = req.userId;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                status: "error",
                message: "User not found.",
            })
        }
        if (user.isBlocked) {
            return res.status(403).json({
                status: "error",
                message: "User is blocked."
            })
        }
        const userBank = await UserBank.findOne({ userId }).populate("userId", "firstName lastName");
        if (!userBank) {
            return res.status(404).json({
                status: "error",
                message: "Bank account not found.",
            });
        }
        return res.status(200).json({
            status: "success",
            message: "Bank account details retrieved successfully.",
            bankDetails: {
                firstName: userBank.userId.firstName,
                lastName: userBank.userId.lastName,
                accountName: userBank.accountName,
                branchName: userBank.branchName,
                accountNumber: userBank.accountNumber,
                ifscCode: userBank.ifscCode,
                balance: userBank.balance,
                createdAt: userBank.createdAt,
            },
        })
    } catch (error) {
        console.error("Get Bank Account Details Error:", error);
        return res.status(500).json({
            status: "error",
            message: "Failed to retrieve bank account details.",
            error,
        });
    }
}

export const getUserData = async (req, res, next) => {
    try {
        const userId = req.userId;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ status: "error", message: "User not found." });
        }

        if (user.isBlocked) {
            return res.status(403).json({ status: "error", message: "User is blocked." });
        }

        return res.status(200).json({
            status: "success",
            message: "User data retrieved successfully.",
            data: {
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
            }
        });
    } catch (error) {
        console.error("Get User Data Error:", error);
        return res.status(500).json({
            status: "error",
            message: "Failed to retrieve user data.",
            error,
        });
    }
}

export const checkAccountCreeation = async (req, res, next) => {
    try {
        const userId = req.userId;
        let user;
        if (userId) {
            user = await User.findById(userId);
        } else {
            user = await User.findOne({ email: req.body.email });
        }
        if (!user) {
            return res.status(404).json({ status: "error", message: "User not found." });
        }

        const isAccountCreated = user.isBankAccountCreated;

        return res.status(200).json({
            status: "success",
            message: "Account Creation Status retrieved successfully.",
            data: {
                isAccountCreated
            }
        });
    } catch (error) {
        console.error("Check Account Creation Error:", error);
        return res.status(500).json({
            status: "error",
            message: "Failed to retrieve account creation status.",
            error,
        });
    }
}

export const getTransactionHistory = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.userId); // Convert userId to ObjectId
        console.log('Fetching transactions for userId:', userId);

        // Fetch the user's bank account(s) using the userId
        const userBanks = await UserBank.find({ userId }).select('accountNumber _id'); // Get account numbers and _id
        const accountIds = userBanks.map(bank => bank._id); // Extract bank _ids

        // Fetch only transactions where the user is the sender (Withdraw transactions)
        const sentTransactions = await Transaction.find({
            fromAccount: { $in: accountIds }  // User must be the sender
        })
        .populate({
            path: 'fromAccount',
            select: 'accountNumber accountName',
            model: UserBank
        });

        // Process transactions to handle `toAccount` properly
        const transactionsWithReceiver = sentTransactions.map(tx => {
            let receiverDetails;

            if (tx.bankType === 'SameBank') {
                receiverDetails = {
                    accountNumber: tx.toAccount?.accountNumber || 'N/A',
                    accountName: tx.toAccount?.accountName || 'N/A'
                };
            } else {
                receiverDetails = {
                    accountNumber: tx.externalBankDetails?.accountNumber || 'N/A',
                    accountName: tx.externalBankDetails?.accountName || 'N/A',
                    bankName: tx.externalBankDetails?.bankName || 'N/A',
                    ifscCode: tx.externalBankDetails?.ifscCode || 'N/A'
                };
            }

            return {
                ...tx.toObject(),
                receiverDetails
            };
        });

        console.log('User Bank IDs:', accountIds);
        console.log('Processed Transactions:', transactionsWithReceiver);

        return res.status(200).json({
            success: true,
            transactions: transactionsWithReceiver  // Return transactions with updated receiver details
        });

    } catch (error) {
        console.error('Error getting transactions:', error);
        return res.status(500).json({
            success: false,
            message: 'Error getting transactions'
        });
    }
};

