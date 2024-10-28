export default {
  data() {
    return {
      maxSize: 1000,
      passwordLength: 6,
      imageTypes: ['image/jpeg', 'image/png'],
      numberReg: /^[\s()+-]*([0-9][\s()+-]*){6,20}$/,
      reg: /^(([^<>()\]\\.,;:\s@"]+(\.[^<>()\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,24}))$/
    };
  },
  methods: {
    imageFile(file){
      if (!this.imageTypes.includes(file['type']) || file['size']/1000 > this.maxSize) {
        return false
      }
      return true
    },
    isValidEmail (email) {
      return this.reg.test(email)
    },
    isValidNumber (number) {
      return this.numberReg.test(number)
    },
    isValidLength(password) {
      return password.length >= this.passwordLength
    },
  }
}
