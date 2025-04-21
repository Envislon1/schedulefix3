
import React from 'react';
import { motion } from 'framer-motion';

const Index = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-soft-background">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center max-w-xl p-8 bg-white rounded-xl shadow-soft"
      >
        <h1 className="text-4xl font-bold mb-4 text-gray-800">
          Welcome to Your Project
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          This is a blank canvas. Start building your amazing application here!
        </p>
        <div className="flex justify-center space-x-4">
          <button 
            className="px-6 py-3 bg-accent text-white rounded-lg hover:bg-accent-dark transition-colors"
            onClick={() => console.log('Get started clicked')}
          >
            Get Started
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default Index;
