import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonInput, IonButton, IonGrid, IonRow, IonCol, IonLabel, IonModal, IonItem } from '@ionic/react';
import React, {useRef, useState} from 'react';
import axios from 'axios';
import { useHistory } from 'react-router-dom';


const Login : React.FC<{setIsAuth: Function}> = ({setIsAuth}) => {
    const usernameRef = useRef<HTMLIonInputElement>(null);
    const phoneRef = useRef<HTMLIonInputElement>(null);
    const tokenRef = useRef<HTMLIonInputElement>(null);
    const [showModal, setShowModal] = useState<boolean>(false);
    const [showError, setShowError] = useState<boolean>(false);
    const history = useHistory();

    const login = () => {
        const username = usernameRef.current!.value;
        const phone = phoneRef.current!.value; 
        axios.post('/login', {
            phone, username
        }).then(() => {
            setShowModal(true);
        }).catch((err) => {
            console.log(err);
            setShowError(true);
        })
    }

    const verifyToken = () => {
        const username = usernameRef.current!.value;
        const phone = phoneRef.current!.value; 
        const otp= tokenRef.current!.value;
        axios.post('/verifyOtp', {
            otp,
            phone,
            username
        }).then(() => {
            console.log('verified user!');
            setIsAuth(true);
            setShowModal(false);
            history.push('/');
        }).catch(err => {
            console.log(err);
            console.log('CANNOT LOGIN!');
            setShowModal(false);
        })
    }

    return (
        <IonPage>
            <IonHeader>
        <IonToolbar>
          <IonTitle>Login</IonTitle>
        </IonToolbar>
      </IonHeader>
        <IonContent fullscreen>
            <IonModal isOpen={showModal}>
                <IonItem>
                    <IonLabel> Verification Token</IonLabel>
                    <IonInput type='number' ref={tokenRef}>
                    </IonInput>
                </IonItem>
                <IonButton onClick={verifyToken}>Verify Login</IonButton>
            </IonModal>
            <IonHeader collapse="condense">
            <IonToolbar>
                <IonTitle size="large">Login</IonTitle>
            </IonToolbar>
            </IonHeader>
            <IonGrid>
                <IonRow>
                    <IonCol>
                        <IonItem>
                            <IonLabel>Username</IonLabel>
                            <IonInput type='email' ref={usernameRef}></IonInput>
                        </IonItem>
                    </IonCol>
                </IonRow>
                <IonRow>
                    <IonCol>
                        <IonItem>
                            <IonLabel> Phone</IonLabel>
                            <IonInput type='tel' ref={phoneRef}></IonInput>
                        </IonItem>
                    </IonCol>
                </IonRow>
                <IonButton onClick={login}> Login </IonButton>
            </IonGrid>
            {showError && <h2> ERROR WITH YOUR TOKEN OR LOGGING IN </h2>}
        </IonContent>
        </IonPage>
    )
}

export default Login;